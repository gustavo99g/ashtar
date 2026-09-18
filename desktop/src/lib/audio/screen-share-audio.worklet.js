class ScreenShareAudioProcessor extends AudioWorkletProcessor {
	constructor() {
		super();

		this.queue = [];
		this.current = null;
		this.offset = 0;

		this.port.onmessage = (event) => {
			if (!(event.data instanceof Float32Array)) {
				return;
			}

			this.queue.push(event.data);
		};
	}

	process(_inputs, outputs) {
		const output = outputs[0];

		const left = output[0];
		const right = output[1];

		for (let i = 0; i < left.length; i++) {
			if (this.current === null || this.offset >= this.current.length) {
				this.current = this.queue.shift() ?? null;
				this.offset = 0;

				if (this.current === null) {
					left[i] = 0;
					right[i] = 0;
					continue;
				}
			}

			left[i] = this.current[this.offset] ?? 0;
			right[i] = this.current[this.offset + 1] ?? 0;

			this.offset += 2;
		}

		return true;
	}
}

registerProcessor("screen-share-audio-processor", ScreenShareAudioProcessor);
