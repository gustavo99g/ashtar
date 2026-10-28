//! Leitura da tabela SMBIOS do firmware: o UUID do sistema e o serial da placa-mãe.
//!
//! Só bytes, sem Windows: o `identity/windows.rs` pede a tabela ao sistema
//! (`GetSystemFirmwareTable` com `RSMB`) e [`parse`] a lê. Assim o parse roda nos testes de
//! qualquer plataforma, com tabelas montadas à mão.
//!
//! O formato (especificação SMBIOS da DMTF, dentro do cabeçalho `RawSMBIOSData` do Windows):
//!
//! - cabeçalho do Windows, 8 bytes: método de chamada, versão maior, versão menor, revisão DMI e
//!   o tamanho da tabela (`u32` little-endian);
//! - as estruturas, uma atrás da outra. Cada uma tem a parte formatada (tipo, tamanho dessa parte,
//!   handle e os campos) e, logo depois, as strings, cada uma terminada em zero, com um zero a mais
//!   no fim. Um campo de string guarda o número da string (1, 2...); 0 é "sem valor";
//! - o tipo 1 (System Information) tem o UUID nos bytes 8 a 23; o tipo 2 (Baseboard) tem o número
//!   da string do serial no byte 7; o tipo 127 marca o fim.
//!
//! Regras: uma tabela quebrada nunca entra em pânico (o que não dá para ler vira `None`), e nada
//! aqui escreve no log.

/// O que a chave usa da tabela. `None` quando a tabela não tem o valor.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HardwareIds {
    /// O UUID do sistema (tipo 1), em maiúsculas: `12345678-9ABC-DEF0-0123-456789ABCDEF`.
    pub system_uuid: Option<String>,
    /// O serial da placa-mãe (tipo 2), sem espaços nas pontas.
    pub board_serial: Option<String>,
}

const HEADER_LEN: usize = 8;
const TYPE_SYSTEM: u8 = 1;
const TYPE_BASEBOARD: u8 = 2;
const TYPE_END: u8 = 127;

/// Lê o UUID e o serial da tabela que o Windows devolve (com o cabeçalho `RawSMBIOSData`).
pub fn parse(raw: &[u8]) -> HardwareIds {
    let mut ids = HardwareIds::default();
    let Some((header, table)) = raw.split_at_checked(HEADER_LEN) else {
        return ids;
    };
    let version = (header[1], header[2]);
    let declared = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    let table = &table[..declared.min(table.len())];

    for structure in structures(table) {
        match structure.kind {
            TYPE_SYSTEM if ids.system_uuid.is_none() => {
                ids.system_uuid = structure
                    .formatted
                    .get(8..24)
                    .and_then(|bytes| bytes.try_into().ok())
                    .map(|bytes| format_uuid(bytes, version));
            }
            TYPE_BASEBOARD if ids.board_serial.is_none() => {
                ids.board_serial = structure
                    .formatted
                    .get(7)
                    .and_then(|&index| structure.string(index));
            }
            _ => {}
        }
    }
    ids
}

/// Uma estrutura da tabela: a parte formatada e a área de strings (sem o zero duplo do fim).
struct Structure<'a> {
    kind: u8,
    formatted: &'a [u8],
    strings: &'a [u8],
}

impl Structure<'_> {
    /// A string de número `index` (a primeira é 1), sem espaços nas pontas. 0, uma string que não
    /// existe ou uma string em branco viram `None`.
    fn string(&self, index: u8) -> Option<String> {
        let position = usize::from(index).checked_sub(1)?;
        let bytes = self.strings.split(|&byte| byte == 0).nth(position)?;
        let text = String::from_utf8_lossy(bytes).trim().to_owned();
        (!text.is_empty()).then_some(text)
    }
}

/// As estruturas, em ordem, até o tipo 127 ou até a primeira que não cabe no que sobrou.
fn structures(table: &[u8]) -> impl Iterator<Item = Structure<'_>> {
    let mut rest = table;
    std::iter::from_fn(move || {
        let kind = *rest.first()?;
        let len = usize::from(*rest.get(1)?);
        if len < 4 || len > rest.len() {
            return None;
        }
        let (formatted, after) = rest.split_at(len);
        // As strings acabam no primeiro par de zeros. Sem strings, a área é só o par.
        let end = after.windows(2).position(|pair| pair == [0, 0])?;
        let strings = &after[..end];
        rest = if kind == TYPE_END {
            &[]
        } else {
            &after[end + 2..]
        };
        Some(Structure {
            kind,
            formatted,
            strings,
        })
    })
}

/// O UUID no formato de texto. Desde a SMBIOS 2.6, os três primeiros campos vêm em little-endian
/// (como um GUID do Windows); antes, a especificação os punha na ordem da tabela (big-endian).
fn format_uuid(bytes: &[u8; 16], (major, minor): (u8, u8)) -> String {
    let little_endian = (major, minor) >= (2, 6);
    let (time_low, time_mid, time_high) = if little_endian {
        (
            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            u16::from_le_bytes([bytes[4], bytes[5]]),
            u16::from_le_bytes([bytes[6], bytes[7]]),
        )
    } else {
        (
            u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            u16::from_be_bytes([bytes[4], bytes[5]]),
            u16::from_be_bytes([bytes[6], bytes[7]]),
        )
    };
    let node: String = bytes[10..]
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect();
    format!(
        "{time_low:08X}-{time_mid:04X}-{time_high:04X}-{:02X}{:02X}-{node}",
        bytes[8], bytes[9]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A área de strings de uma estrutura: cada string terminada em zero e um zero a mais no fim
    /// (sem strings, só os dois zeros).
    fn strings(list: &[&str]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for text in list {
            bytes.extend(text.as_bytes());
            bytes.push(0);
        }
        if list.is_empty() {
            bytes.push(0);
        }
        bytes.push(0);
        bytes
    }

    /// O cabeçalho `RawSMBIOSData` na frente da tabela, como o Windows entrega.
    fn with_header(version: (u8, u8), table: Vec<u8>) -> Vec<u8> {
        // Método de chamada 0, versão maior e menor, revisão DMI 0 e o tamanho da tabela.
        let mut raw = vec![0x00, version.0, version.1, 0x00];
        raw.extend((table.len() as u32).to_le_bytes());
        raw.extend(table);
        raw
    }

    /// O tipo 1 (System Information) da amostra, com 27 bytes formatados (SMBIOS 2.4 em diante).
    fn system_information() -> Vec<u8> {
        // Tipo 1, 27 (0x1B) bytes formatados, handle 0x0001.
        let mut bytes = vec![0x01, 0x1B, 0x01, 0x00];
        // Fabricante, produto, versão e serial do sistema: as strings 1 a 4.
        bytes.extend([0x01, 0x02, 0x03, 0x04]);
        bytes.extend([
            0x78, 0x56, 0x34, 0x12, // UUID: time_low (12345678 em little-endian)
            0xBC, 0x9A, // time_mid (9ABC)
            0xF0, 0xDE, // time_high (DEF0)
            0x01, 0x23, // clock_seq, sempre na ordem
            0x89, 0xAB, 0xCD, 0xEF, 0x01, 0x23, // node, sempre na ordem
        ]);
        bytes.extend([0x06, 0x05, 0x06]); // wake-up "botão de energia", SKU (string 5), família (6)
        bytes.extend(strings(&[
            "Micro-Star International Co., Ltd.",
            "MS-7C56",
            "1.0",
            // O serial do sistema (tipo 1) costuma vir em branco; a chave usa o da placa.
            "To be filled by O.E.M.",
            "To be filled by O.E.M.",
            "Desktop",
        ]));
        bytes
    }

    /// O tipo 2 (Baseboard) da amostra, com 15 bytes formatados.
    fn baseboard(serial_index: u8) -> Vec<u8> {
        // Tipo 2, 15 (0x0F) bytes formatados, handle 0x0002.
        let mut bytes = vec![0x02, 0x0F, 0x02, 0x00];
        // Fabricante, produto, versão, serial (o byte 7) e etiqueta: strings 1, 2, 3, ?, 5.
        bytes.extend([0x01, 0x02, 0x03, serial_index, 0x05]);
        // Flags, local no gabinete (string 6), handle do gabinete 0x0003, tipo 0x0A ("placa-mãe")
        // e nenhum objeto dentro.
        bytes.extend([0x09, 0x06, 0x03, 0x00, 0x0A, 0x00]);
        bytes.extend(strings(&[
            "Micro-Star International Co., Ltd.",
            "B550-A PRO (MS-7C56)",
            "1.0",
            "07C5611_K91E123456",
            "Default string",
            "Default string",
        ]));
        bytes
    }

    /// Uma tabela de amostra com a forma de uma placa MSI B550 real, valores trocados.
    fn sample(version: (u8, u8)) -> Vec<u8> {
        let mut table = Vec::new();
        // Um tipo 0 (BIOS) encurtado, só para o parse ter de pular uma estrutura com strings:
        // tipo 0, 5 bytes formatados, handle 0x0000 e o fabricante na string 1.
        table.extend([0x00, 0x05, 0x00, 0x00, 0x01]);
        table.extend(strings(&["American Megatrends International, LLC."]));
        table.extend(system_information());
        table.extend(baseboard(0x04));
        table.extend([0x7F, 0x04, 0x03, 0x00]); // tipo 127, fim da tabela
        table.extend(strings(&[]));
        with_header(version, table)
    }

    #[test]
    fn le_o_uuid_do_sistema_e_o_serial_da_placa() {
        let ids = parse(&sample((3, 3)));
        assert_eq!(
            ids.system_uuid.as_deref(),
            Some("12345678-9ABC-DEF0-0123-89ABCDEF0123")
        );
        assert_eq!(ids.board_serial.as_deref(), Some("07C5611_K91E123456"));
    }

    #[test]
    fn antes_da_2_6_o_uuid_fica_na_ordem_da_tabela() {
        let ids = parse(&sample((2, 5)));
        assert_eq!(
            ids.system_uuid.as_deref(),
            Some("78563412-BC9A-F0DE-0123-89ABCDEF0123")
        );
    }

    #[test]
    fn string_zero_e_estrutura_que_falta_viram_none() {
        let mut table = system_information();
        table.extend(baseboard(0x00)); // serial "sem valor"
        let ids = parse(&with_header((3, 3), table));
        assert!(ids.system_uuid.is_some());
        assert_eq!(ids.board_serial, None);

        let ids = parse(&with_header((3, 3), baseboard(0x04)));
        assert_eq!(ids.system_uuid, None);
        assert!(ids.board_serial.is_some());
    }

    #[test]
    fn um_tipo_1_curto_demais_nao_tem_uuid() {
        // SMBIOS 2.0: o tipo 1 tinha só 8 bytes, sem o UUID.
        let mut table = vec![0x01, 0x08, 0x01, 0x00, 0x01, 0x02, 0x03, 0x04];
        table.extend(strings(&["Fabricante", "Produto", "1.0", "123"]));
        assert_eq!(parse(&with_header((2, 0), table)).system_uuid, None);
    }

    #[test]
    fn tabela_cortada_em_qualquer_ponto_nao_entra_em_panico() {
        let raw = sample((3, 3));
        for end in 0..raw.len() {
            let _ = parse(&raw[..end]);
        }
        // O tamanho declarado no cabeçalho maior que a tabela também não.
        let mut raw = sample((3, 3));
        raw[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(parse(&raw).board_serial.is_some());
    }
}
