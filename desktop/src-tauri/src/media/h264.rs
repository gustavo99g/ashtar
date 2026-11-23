//! Conserta o H.264 que sai de um encoder de hardware antes de ir para a LiveKit.
//!
//! Quem assiste só decodifica a partir de um keyframe que traga o SPS e o PPS na frente, em
//! Annex B (cada NAL começando com `00 00 00 01`). A NVIDIA e as AMD mais novas entregam assim,
//! mas nem todo driver faz o mesmo: alguns mandam o SPS e o PPS só no tipo de mídia
//! (`MF_MT_MPEG_SEQUENCE_HEADER`) ou só no primeiro keyframe, outros não marcam o keyframe na
//! amostra, e quem assiste fica com a tela preta esperando um keyframe que dê para decodificar.
//!
//! [`ParamSets::fix`] olha os NAL de cada saída: o keyframe é o que tem um IDR, e um IDR sem o
//! SPS ou o PPS ganha os últimos que o encoder mandou. Uma saída com tamanhos na frente de cada
//! NAL (o formato do MP4) vira Annex B.

const START_CODE: [u8; 4] = [0, 0, 0, 1];

/// O tipo de um NAL (os 5 bits de baixo do primeiro byte).
const NAL_IDR: u8 = 5;
const NAL_SPS: u8 = 7;
const NAL_PPS: u8 = 8;

/// Os NAL de um access unit em Annex B, sem os start codes.
pub fn nal_units(data: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new(); // (onde o start code começa, onde o NAL começa)
    let mut i = 0;
    while i + 3 <= data.len() {
        if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            let begin = if i > 0 && data[i - 1] == 0 { i - 1 } else { i };
            starts.push((begin, i + 3));
            i += 3;
        } else {
            i += 1;
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(n, &(_, nal))| {
            let end = starts.get(n + 1).map_or(data.len(), |&(next, _)| next);
            &data[nal..end]
        })
        .filter(|nal| !nal.is_empty())
        .collect()
}

/// O tipo de cada NAL do access unit, para o log.
pub fn nal_types(data: &[u8]) -> Vec<u8> {
    nal_units(data).iter().map(|nal| nal[0] & 0x1F).collect()
}

/// Se `data` começa com um start code de Annex B.
fn is_annex_b(data: &[u8]) -> bool {
    data.starts_with(&[0, 0, 1]) || data.starts_with(&START_CODE)
}

/// Converte NAL com o tamanho na frente (4 bytes, big endian) para Annex B. `None` se os tamanhos
/// não fecham exatamente com o tamanho dos dados.
fn length_prefixed_to_annex_b(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len());
    let mut rest = data;
    while !rest.is_empty() {
        let (len, tail) = rest.split_first_chunk::<4>()?;
        let len = u32::from_be_bytes(*len) as usize;
        if len == 0 || len > tail.len() {
            return None;
        }
        out.extend_from_slice(&START_CODE);
        out.extend_from_slice(&tail[..len]);
        rest = &tail[len..];
    }
    (!out.is_empty()).then_some(out)
}

/// Os dados em Annex B: como vieram, ou convertidos do formato com tamanhos na frente.
pub fn to_annex_b(data: Vec<u8>) -> Vec<u8> {
    if is_annex_b(&data) {
        return data;
    }
    length_prefixed_to_annex_b(&data).unwrap_or(data)
}

/// O último SPS e o último PPS que o encoder mandou, com o start code na frente.
#[derive(Debug, Default)]
pub struct ParamSets {
    sps: Option<Vec<u8>>,
    pps: Option<Vec<u8>>,
}

impl ParamSets {
    /// Guarda o SPS e o PPS que estiverem em `data` (Annex B ou com tamanhos na frente).
    pub fn learn(&mut self, data: &[u8]) {
        let data = to_annex_b(data.to_vec());
        for nal in nal_units(&data) {
            let mut with_start = START_CODE.to_vec();
            with_start.extend_from_slice(nal);
            match nal[0] & 0x1F {
                NAL_SPS => self.sps = Some(with_start),
                NAL_PPS => self.pps = Some(with_start),
                _ => {}
            }
        }
    }

    /// Uma saída do encoder pronta para ir: em Annex B e, se tiver um IDR, com o SPS e o PPS na
    /// frente. Devolve também se é keyframe: se tem um IDR, ou, se os NAL não deram para ler,
    /// `marked` (o que o encoder disse na amostra).
    pub fn fix(&mut self, data: Vec<u8>, marked: bool) -> (Vec<u8>, bool) {
        let data = to_annex_b(data);
        let types = nal_types(&data);
        self.learn_from(&data, &types);
        if types.is_empty() {
            return (data, marked); // não deu para ler: fica com o que o encoder disse
        }
        if !types.contains(&NAL_IDR) {
            return (data, false);
        }
        let mut missing = Vec::new();
        if !types.contains(&NAL_SPS) {
            missing.extend(self.sps.iter().flatten());
        }
        if !types.contains(&NAL_PPS) {
            missing.extend(self.pps.iter().flatten());
        }
        if missing.is_empty() {
            return (data, true);
        }
        missing.extend_from_slice(&data);
        (missing, true)
    }

    fn learn_from(&mut self, data: &[u8], types: &[u8]) {
        if types.contains(&NAL_SPS) || types.contains(&NAL_PPS) {
            self.learn(data);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPS: [u8; 5] = [0, 0, 0, 1, 0x67];
    const PPS: [u8; 5] = [0, 0, 0, 1, 0x68];
    const IDR: [u8; 6] = [0, 0, 0, 1, 0x65, 0xAA];
    const SLICE: [u8; 6] = [0, 0, 0, 1, 0x41, 0xBB];

    fn join(parts: &[&[u8]]) -> Vec<u8> {
        parts.concat()
    }

    #[test]
    fn le_os_tipos_com_start_codes_de_3_e_4_bytes() {
        let data = join(&[&SPS, &[0, 0, 1, 0x68], &IDR]);
        assert_eq!(nal_types(&data), vec![7, 8, 5]);
        assert_eq!(nal_units(&data)[2], &[0x65, 0xAA]);
    }

    #[test]
    fn keyframe_completo_passa_como_veio() {
        let mut sets = ParamSets::default();
        let data = join(&[&SPS, &PPS, &IDR]);
        assert_eq!(sets.fix(data.clone(), true), (data, true));
    }

    #[test]
    fn idr_sem_sps_ganha_o_ultimo_que_veio() {
        let mut sets = ParamSets::default();
        sets.fix(join(&[&SPS, &PPS, &IDR]), true);
        let (data, keyframe) = sets.fix(IDR.to_vec(), false);
        assert!(keyframe, "o IDR é keyframe mesmo sem a marca na amostra");
        assert_eq!(data, join(&[&SPS, &PPS, &IDR]));
    }

    #[test]
    fn sps_do_tipo_de_midia_entra_no_primeiro_idr() {
        let mut sets = ParamSets::default();
        sets.learn(&join(&[&SPS, &PPS]));
        let (data, keyframe) = sets.fix(IDR.to_vec(), true);
        assert!(keyframe);
        assert_eq!(data, join(&[&SPS, &PPS, &IDR]));
    }

    #[test]
    fn quadro_comum_nao_e_keyframe_nem_muda() {
        let mut sets = ParamSets::default();
        sets.learn(&join(&[&SPS, &PPS]));
        assert_eq!(sets.fix(SLICE.to_vec(), false), (SLICE.to_vec(), false));
        assert_eq!(sets.fix(SLICE.to_vec(), true), (SLICE.to_vec(), false));
    }

    #[test]
    fn tamanhos_na_frente_viram_annex_b() {
        let data = vec![0, 0, 0, 2, 0x65, 0xAA, 0, 0, 0, 2, 0x41, 0xBB];
        assert_eq!(to_annex_b(data), join(&[&IDR, &SLICE]));
        // Tamanhos que não fecham: fica como veio.
        let broken = vec![0, 0, 0, 9, 0x65, 0xAA];
        assert_eq!(to_annex_b(broken.clone()), broken);
    }
}
