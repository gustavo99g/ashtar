//! As duas fontes da chave no Windows: a tabela SMBIOS do firmware e o Gerenciador de Credenciais.
//!
//! Só chamadas ao sistema, sem regra: o que fazer com os bytes está em `smbios.rs` e `key.rs`, e
//! quem decide é o `identity/mod.rs`. Nada aqui escreve no log.

use std::ffi::c_void;
use std::{io, iter, ptr, slice};

use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
use windows_sys::Win32::Security::Credentials::{
    CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};
use windows_sys::Win32::System::SystemInformation::{GetSystemFirmwareTable, RSMB};

/// O que aparece no Gerenciador de Credenciais, ao lado do nome do alvo.
const CREDENTIAL_COMMENT: &str =
    "Chave deste computador no Ashtar. Apagada, a conta só volta com um convite de recuperação.";

/// A tabela SMBIOS inteira, com o cabeçalho `RawSMBIOSData` do Windows na frente.
///
/// # Bloqueia
///
/// Chamada ao sistema (rápida, mas síncrona): chamar dentro de `spawn_blocking`.
pub fn read_smbios() -> io::Result<Vec<u8>> {
    // SAFETY: com buffer nulo e tamanho 0, a função não escreve nada e só devolve o tamanho
    // necessário (0 em caso de erro).
    let size = unsafe { GetSystemFirmwareTable(RSMB, 0, ptr::null_mut(), 0) };
    if size == 0 {
        return Err(io::Error::last_os_error());
    }

    let mut buffer = vec![0u8; size as usize];
    // SAFETY: `buffer` tem `size` bytes graváveis e vive até o fim da função; a função escreve no
    // máximo `size` bytes.
    let written = unsafe { GetSystemFirmwareTable(RSMB, 0, buffer.as_mut_ptr(), size) };
    if written == 0 {
        return Err(io::Error::last_os_error());
    }
    if written > size {
        // A tabela cresceu entre as duas chamadas: o que veio está cortado.
        return Err(io::Error::other(
            "a tabela SMBIOS mudou de tamanho durante a leitura",
        ));
    }
    buffer.truncate(written as usize);
    Ok(buffer)
}

/// O texto em UTF-16 terminado em zero, como as funções `...W` do Windows pedem.
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(iter::once(0)).collect()
}

/// Os bytes da credencial genérica `target`, ou `None` se ela não existe.
///
/// # Bloqueia
///
/// Chamada ao sistema: chamar dentro de `spawn_blocking`.
pub fn read_credential(target: &str) -> io::Result<Option<Vec<u8>>> {
    let target = wide(target);
    let mut credential: *mut CREDENTIALW = ptr::null_mut();
    // SAFETY: `target` termina em zero e vive até o fim da função; `credential` é um ponteiro de
    // saída válido, que o sistema preenche só quando a função dá certo.
    let found = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if found == 0 {
        let error = io::Error::last_os_error();
        return match error.raw_os_error() {
            Some(code) if code == ERROR_NOT_FOUND as i32 => Ok(None),
            _ => Err(error),
        };
    }

    // SAFETY: com sucesso, `credential` aponta para um CREDENTIALW alocado pelo sistema, com
    // `CredentialBlobSize` bytes em `CredentialBlob` (nulo quando o tamanho é 0), válido até o
    // `CredFree` logo abaixo. Os bytes são copiados antes dele.
    let blob = unsafe {
        let credential = &*credential;
        if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
            Vec::new()
        } else {
            slice::from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            )
            .to_vec()
        }
    };
    // SAFETY: `credential` veio do `CredReadW` acima e é liberado uma vez só, sem uso depois.
    unsafe { CredFree(credential.cast_const().cast::<c_void>()) };
    Ok(Some(blob))
}

/// Grava `blob` como a credencial genérica `target`, deste usuário e só deste computador
/// (`CRED_PERSIST_LOCAL_MACHINE`: não vai junto num perfil móvel). Uma que já existe é trocada.
///
/// # Bloqueia
///
/// Chamada ao sistema: chamar dentro de `spawn_blocking`.
pub fn write_credential(target: &str, blob: &[u8]) -> io::Result<()> {
    let mut target = wide(target);
    let mut comment = wide(CREDENTIAL_COMMENT);
    let size = u32::try_from(blob.len()).map_err(io::Error::other)?;
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        Comment: comment.as_mut_ptr(),
        CredentialBlobSize: size,
        CredentialBlob: blob.as_ptr().cast_mut(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    // SAFETY: os ponteiros de `credential` apontam para `target`, `comment` (os dois terminados em
    // zero) e `blob`, que vivem até o fim da função; o `CredWriteW` só lê e copia.
    let written = unsafe { CredWriteW(&credential, 0) };
    if written == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
