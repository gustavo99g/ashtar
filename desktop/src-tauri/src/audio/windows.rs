use hound::{SampleFormat, WavSpec, WavWriter};
use std::{
    error::Error,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use tauri::ipc::Channel;
use wasapi::{
    initialize_mta, AudioCaptureClient, AudioClient, DeviceEnumerator, Direction, SampleType,
    StreamMode, WaveFormat,
};

use super::ScreenShareAudioMode;

pub struct WindowsSystemAudioCapture {
    client: AudioClient,
    capture_client: AudioCaptureClient,
}

impl WindowsSystemAudioCapture {
    pub fn new(mode: ScreenShareAudioMode) -> Result<Self, Box<dyn Error>> {
        initialize_mta();
        let (process_id, include_tree) = match mode {
            ScreenShareAudioMode::System(process_id) => {
                println!("Captura: sistema exceto processo {process_id}");
                (process_id, false)
            }
            ScreenShareAudioMode::Application(process_id) => {
                println!("Captura: processo {process_id}");
                (process_id, true)
            }
        };

        let mut client = AudioClient::new_application_loopback_client(process_id, include_tree)?;

        let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);

        println!("Sample rate: {}", format.get_samplespersec());
        println!("Channels: {}", format.get_nchannels());
        println!("Bits: {}", format.get_bitspersample());

        client.initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::PollingShared {
                autoconvert: true,
                buffer_duration_hns: 200_000,
            },
        )?;

        let capture_client = client.get_audiocaptureclient()?;

        Ok(Self {
            client,
            capture_client,
        })
    }

    pub fn start(&self) -> Result<(), Box<dyn Error>> {
        self.client.start_stream()?;
        Ok(())
    }

    pub fn stream_to_channel(
        self,
        channel: Channel<Vec<u8>>,
        stop: Arc<AtomicBool>,
    ) -> Result<(), Box<dyn Error>> {
        self.client.start_stream()?;
        let bytes_per_sample = 4usize;
        let channels = 2usize;
        let bytes_per_frame = bytes_per_sample * channels;

        while !stop.load(Ordering::Relaxed) {
            let frames = self.capture_client.get_next_packet_size()?.unwrap_or(0);
            if frames == 0 {
                thread::sleep(Duration::from_millis(1));
                continue;
            }

            let buffer_size = frames as usize * bytes_per_frame;

            let mut buffer = vec![0u8; buffer_size];

            let (frames_read, buffer_info) = self.capture_client.read_from_device(&mut buffer)?;

            let bytes_read = frames_read as usize * bytes_per_frame;

            if bytes_read == 0 {
                continue;
            }

            buffer.truncate(bytes_read);

            // println!(
            //     "Enviando {} frames / {} bytes / silent={}",
            //     frames_read,
            //     buffer.len(),
            //     buffer_info.flags.silent
            // );
            if channel.send(buffer).is_err() {
                break;
            }
        }
        self.client.stop_stream()?;

        println!("Captura de áudio encerrada.");

        Ok(())
    }
}
