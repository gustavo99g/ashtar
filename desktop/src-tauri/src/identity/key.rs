//! A chave do computador a partir do hardware, e quando o hardware não serve.
//!
//! Só regra, sem Windows: o `identity/mod.rs` lê a tabela, chama [`hardware_key`] e, se ela
//! recusar, usa a chave aleatória ([`random_key`]). Testado em qualquer plataforma.
//!
//! As duas chaves saem em hexadecimal minúsculo com 64 caracteres, dentro do que a API aceita
//! (de 32 a 128 letras, números, `-` e `_`), e a API não sabe qual das duas recebeu.

use sha2::{Digest, Sha256};

use super::smbios::HardwareIds;

/// Entra no hash antes do UUID e do serial: outro programa que usasse os mesmos dois valores não
/// chegaria à mesma chave. Mudar este texto muda a chave de todos os computadores, e cada um
/// precisaria de um convite de recuperação.
const KEY_DOMAIN: &str = "ashtar/device-key/v1";

/// UUIDs que muitos computadores têm ao mesmo tempo: zerado e todo F (a especificação SMBIOS diz
/// "não gravado") e o de placas baratas que saem de fábrica sem UUID.
const GENERIC_UUIDS: [&str; 3] = [
    "00000000-0000-0000-0000-000000000000",
    "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
    "03000200-0400-0500-0006-000700080009",
];

/// Seriais de placa-mãe que o fabricante deixou sem preencher.
const GENERIC_SERIALS: [&str; 7] = [
    "",
    "To be filled by O.E.M.",
    "Default string",
    "Not Specified",
    "System Serial Number",
    "None",
    "0",
];

/// Por que o hardware não serve. O log mostra o motivo, nunca os valores.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenericHardware {
    Uuid,
    Serial,
    Both,
}

impl GenericHardware {
    pub fn describe(self) -> &'static str {
        match self {
            Self::Uuid => "uuid genérico",
            Self::Serial => "serial genérico",
            Self::Both => "uuid e serial genéricos",
        }
    }
}

/// Se o UUID é um dos genéricos (sem diferenciar maiúsculas).
pub fn is_generic_uuid(uuid: &str) -> bool {
    let uuid = uuid.trim();
    GENERIC_UUIDS
        .iter()
        .any(|generic| generic.eq_ignore_ascii_case(uuid))
}

/// Se o serial é um dos genéricos (sem diferenciar maiúsculas nem espaços nas pontas).
pub fn is_generic_serial(serial: &str) -> bool {
    let serial = serial.trim();
    GENERIC_SERIALS
        .iter()
        .any(|generic| generic.eq_ignore_ascii_case(serial))
}

/// A chave do hardware, ou o motivo de ele não servir. Um valor que falta na tabela conta como
/// genérico.
pub fn hardware_key(ids: &HardwareIds) -> Result<String, GenericHardware> {
    let uuid = ids
        .system_uuid
        .as_deref()
        .filter(|uuid| !is_generic_uuid(uuid));
    let serial = ids
        .board_serial
        .as_deref()
        .filter(|serial| !is_generic_serial(serial));
    match (uuid, serial) {
        (Some(uuid), Some(serial)) => Ok(hash(uuid, serial)),
        (None, Some(_)) => Err(GenericHardware::Uuid),
        (Some(_), None) => Err(GenericHardware::Serial),
        (None, None) => Err(GenericHardware::Both),
    }
}

/// SHA-256 de `KEY_DOMAIN`, UUID e serial, com um byte zero entre as partes, em hex minúsculo.
///
/// O zero separa sem ambiguidade: nenhuma das partes pode conter um (as strings da SMBIOS
/// terminam nele), então `("AB", "C")` e `("A", "BC")` nunca dão o mesmo hash.
fn hash(uuid: &str, serial: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(KEY_DOMAIN.as_bytes());
    hasher.update([0]);
    hasher.update(uuid.as_bytes());
    hasher.update([0]);
    hasher.update(serial.as_bytes());
    to_hex(&hasher.finalize())
}

/// Os bytes em hexadecimal minúsculo, dois caracteres por byte.
fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A chave aleatória a partir dos 32 bytes guardados no Gerenciador de Credenciais.
pub fn random_key(bytes: &[u8; 32]) -> String {
    to_hex(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(uuid: Option<&str>, serial: Option<&str>) -> HardwareIds {
        HardwareIds {
            system_uuid: uuid.map(str::to_owned),
            board_serial: serial.map(str::to_owned),
        }
    }

    const UUID: &str = "12345678-9ABC-DEF0-0123-89ABCDEF0123";
    const SERIAL: &str = "07C5611_K91E123456";

    fn is_key(key: &str) -> bool {
        key.len() == 64
            && key
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }

    #[test]
    fn os_uuids_genericos() {
        for uuid in [
            "00000000-0000-0000-0000-000000000000",
            "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
            "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "03000200-0400-0500-0006-000700080009",
        ] {
            assert!(is_generic_uuid(uuid), "{uuid}");
        }
        assert!(!is_generic_uuid(UUID));
    }

    #[test]
    fn os_seriais_genericos() {
        for serial in [
            "",
            "   ",
            "To be filled by O.E.M.",
            "TO BE FILLED BY O.E.M.",
            "Default string",
            " Not Specified ",
            "System Serial Number",
            "None",
            "0",
        ] {
            assert!(is_generic_serial(serial), "{serial:?}");
        }
        for serial in [SERIAL, "00", "Default", "N/A123"] {
            assert!(!is_generic_serial(serial), "{serial:?}");
        }
    }

    #[test]
    fn a_chave_do_hardware_tem_64_caracteres_hex_minusculos() {
        let key = hardware_key(&ids(Some(UUID), Some(SERIAL))).unwrap();
        assert!(is_key(&key), "{key}");
    }

    #[test]
    fn a_chave_do_exemplo_nunca_muda() {
        // Se este teste falhar, a conta mudou, e todo computador do grupo vai precisar de uma
        // recuperação. Calculado à parte: sha256("ashtar/device-key/v1\0<UUID>\0<SERIAL>").
        assert_eq!(
            hardware_key(&ids(Some(UUID), Some(SERIAL))).unwrap(),
            "a0bf7b534832551dc8de2a20aa3c75d885f4c2119b5ce826c20b2e1af26828ea"
        );
    }

    #[test]
    fn o_separador_evita_ambiguidade() {
        let a = hardware_key(&ids(Some(UUID), Some("AB1"))).unwrap();
        let b = hardware_key(&ids(Some(UUID), Some("AB12"))).unwrap();
        assert_ne!(a, b);
        assert_ne!(hash("AB", "C"), hash("A", "BC"));
    }

    #[test]
    fn hardware_generico_diz_o_motivo() {
        assert_eq!(
            hardware_key(&ids(Some(GENERIC_UUIDS[2]), Some(SERIAL))),
            Err(GenericHardware::Uuid)
        );
        assert_eq!(
            hardware_key(&ids(Some(UUID), Some("Default string"))),
            Err(GenericHardware::Serial)
        );
        assert_eq!(hardware_key(&ids(None, None)), Err(GenericHardware::Both));
    }

    #[test]
    fn a_chave_aleatoria_tem_o_mesmo_formato() {
        let key = random_key(&[0xAB; 32]);
        assert!(is_key(&key), "{key}");
        assert_eq!(&key[..4], "abab");
    }
}
