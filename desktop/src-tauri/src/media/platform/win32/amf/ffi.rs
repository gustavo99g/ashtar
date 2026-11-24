//! A ligação com o AMF, a biblioteca de vídeo da AMD (plano `v0.8-amf.md`).
//!
//! O AMF vem com o driver da AMD (`amfrt64.dll`): nada é instalado com o app. A DLL é carregada
//! na primeira vez que alguém precisa dela e fica carregada até o fim do processo.
//!
//! As interfaces do AMF são classes C++ com uma versão em C (uma struct com o ponteiro para a
//! vtable). Aqui ficam só as vtables que o app usa, copiadas **na mesma ordem** dos cabeçalhos
//! públicos do SDK (github.com/GPUOpen-LibrariesAndSDKs/AMF, `amf/public/include`, licença MIT).
//! As funções que o app não chama viram `usize` (o mesmo tamanho de um ponteiro), só para manter
//! as posições. Uma posição errada aqui derruba o app em vez de dar erro: mexer só conferindo o
//! cabeçalho, linha a linha.

use std::ffi::c_void;
use std::sync::OnceLock;

use windows::core::{GUID, PCWSTR};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

use crate::error::AppError;

/// `AMF_RESULT` (`core/Result.h`): `AMF_OK` é 0 e os outros seguem a ordem do enum.
pub type AmfResult = i32;
pub const AMF_OK: AmfResult = 0;
pub const AMF_EOF: AmfResult = 23;
pub const AMF_REPEAT: AmfResult = 24;
pub const AMF_INPUT_FULL: AmfResult = 25;
pub const AMF_NEED_MORE_INPUT: AmfResult = 44;

/// `AMF_SURFACE_NV12` (`core/Surface.h`).
pub const AMF_SURFACE_NV12: i32 = 1;
/// `AMF_DX11_0` (`core/Data.h`, `AMF_DX_VERSION`).
pub const AMF_DX11_0: i32 = 110;

/// A versão do AMF que o app pede (`AMF_MAKE_FULL_VERSION(1, 4, 0, 0)`, `core/Version.h`): tudo
/// que o app usa existe desde a 1.4, e um driver mais novo atende um pedido mais velho.
const AMF_VERSION_1_4: u64 = (1 << 48) | (4 << 32);

/// O IID do `AMFBuffer` (`core/Buffer.h`, `AMF_DECLARE_IID(AMFBuffer, ...)`).
pub const IID_AMF_BUFFER: GUID = GUID::from_values(
    0xb04b7248,
    0xb6f0,
    0x4321,
    [0xb6, 0x91, 0xba, 0xa4, 0x74, 0x0f, 0x9f, 0xcb],
);

/// `AMFVariantStruct` (`core/Variant.h`): o tipo e um union de 16 bytes alinhado em 8 (o maior
/// membro é o `AMFRect`/`AMFFloatVector4D`).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct AmfVariant {
    kind: i32,
    value: [u64; 2],
}

/// Os tipos do `AMF_VARIANT_TYPE` que o app usa.
const AMF_VARIANT_BOOL: i32 = 1;
const AMF_VARIANT_INT64: i32 = 2;
const AMF_VARIANT_SIZE: i32 = 5;
const AMF_VARIANT_RATE: i32 = 7;

impl AmfVariant {
    pub fn int(value: i64) -> Self {
        Self {
            kind: AMF_VARIANT_INT64,
            value: [value as u64, 0],
        }
    }

    /// `amf_bool` é o `bool` de C++ (1 byte): o primeiro byte do union.
    pub fn bool(value: bool) -> Self {
        Self {
            kind: AMF_VARIANT_BOOL,
            value: [u64::from(value), 0],
        }
    }

    /// `AMFRate { amf_uint32 num; amf_uint32 den; }`.
    pub fn rate(num: u32, den: u32) -> Self {
        Self {
            kind: AMF_VARIANT_RATE,
            value: [u64::from(num) | (u64::from(den) << 32), 0],
        }
    }

    /// `AMFSize { amf_int32 width; amf_int32 height; }`.
    pub fn size(width: u32, height: u32) -> Self {
        Self {
            kind: AMF_VARIANT_SIZE,
            value: [u64::from(width) | (u64::from(height) << 32), 0],
        }
    }

    pub fn empty() -> Self {
        Self {
            kind: 0,
            value: [0, 0],
        }
    }

    /// O valor como inteiro, se for `AMF_VARIANT_INT64`.
    pub fn as_int(&self) -> Option<i64> {
        (self.kind == AMF_VARIANT_INT64).then_some(self.value[0] as i64)
    }
}

// --- vtables -------------------------------------------------------------------------------------

/// `AMFFactoryVtbl` (`core/Factory.h`). A fábrica não é um `AMFInterface`: não tem `Acquire` nem
/// `Release`, e vive enquanto a DLL estiver carregada.
#[repr(C)]
pub struct FactoryVtbl {
    pub create_context: unsafe extern "system" fn(*mut Factory, *mut *mut Context) -> AmfResult,
    pub create_component: unsafe extern "system" fn(
        *mut Factory,
        *mut Context,
        PCWSTR,
        *mut *mut Component,
    ) -> AmfResult,
    // SetCacheFolder, GetCacheFolder, GetDebug, GetTrace, GetPrograms
    _rest: [usize; 5],
}

#[repr(C)]
pub struct Factory {
    pub vtbl: *const FactoryVtbl,
}

/// O começo comum a todo `AMFInterface` + `AMFPropertyStorage` (`core/Interface.h` e
/// `core/PropertyStorage.h`): 13 funções.
#[repr(C)]
pub struct StorageVtbl {
    // `amf_long` é o `long` do Windows: 32 bits.
    pub acquire: unsafe extern "system" fn(*mut c_void) -> i32,
    pub release: unsafe extern "system" fn(*mut c_void) -> i32,
    pub query_interface:
        unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> AmfResult,
    pub set_property: unsafe extern "system" fn(*mut c_void, PCWSTR, AmfVariant) -> AmfResult,
    pub get_property: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut AmfVariant) -> AmfResult,
    // HasProperty, GetPropertyCount, GetPropertyAt, Clear, AddTo, CopyTo, AddObserver,
    // RemoveObserver
    _rest: [usize; 8],
}

/// `AMFContextVtbl` (`core/Context.h`).
#[repr(C)]
pub struct ContextVtbl {
    pub storage: StorageVtbl,
    pub terminate: unsafe extern "system" fn(*mut Context) -> AmfResult,
    // InitDX9, GetDX9Device, LockDX9, UnlockDX9
    _dx9: [usize; 4],
    pub init_dx11: unsafe extern "system" fn(*mut Context, *mut c_void, i32) -> AmfResult,
    // GetDX11Device, LockDX11, UnlockDX11,
    // InitOpenCL, GetOpenCLContext, GetOpenCLCommandQueue, GetOpenCLDeviceID,
    // GetOpenCLComputeFactory, InitOpenCLEx, LockOpenCL, UnlockOpenCL,
    // InitOpenGL, GetOpenGLContext, GetOpenGLDrawable, LockOpenGL, UnlockOpenGL,
    // InitXV, GetXVDevice, LockXV, UnlockXV,
    // InitGralloc, GetGrallocDevice, LockGralloc, UnlockGralloc,
    // AllocBuffer, AllocSurface, AllocAudioBuffer,
    // CreateBufferFromHostNative, CreateSurfaceFromHostNative, CreateSurfaceFromDX9Native
    _between: [usize; 30],
    pub create_surface_from_dx11_native: unsafe extern "system" fn(
        *mut Context,
        *mut c_void,
        *mut *mut Surface,
        *mut c_void,
    ) -> AmfResult,
}

#[repr(C)]
pub struct Context {
    pub vtbl: *const ContextVtbl,
}

/// `AMFComponentVtbl` (`components/Component.h`), na ordem do Windows: o MSVC inverte os
/// métodos sobrecarregados `GetPropertyInfo`/`GetPropertyInfoAt` (o cabeçalho tem o `#if
/// defined(_WIN32)`), mas a posição dos que o app usa não depende disso.
#[repr(C)]
pub struct ComponentVtbl {
    pub storage: StorageVtbl,
    // GetPropertiesInfoCount, GetPropertyInfo, GetPropertyInfoAt, ValidateProperty
    _info: [usize; 4],
    pub init: unsafe extern "system" fn(*mut Component, i32, i32, i32) -> AmfResult,
    // ReInit
    _reinit: usize,
    pub terminate: unsafe extern "system" fn(*mut Component) -> AmfResult,
    pub drain: unsafe extern "system" fn(*mut Component) -> AmfResult,
    // Flush
    _flush: usize,
    pub submit_input: unsafe extern "system" fn(*mut Component, *mut c_void) -> AmfResult,
    pub query_output: unsafe extern "system" fn(*mut Component, *mut *mut c_void) -> AmfResult,
    // GetContext, SetOutputDataAllocatorCB, GetCaps, Optimize
    _rest: [usize; 4],
}

#[repr(C)]
pub struct Component {
    pub vtbl: *const ComponentVtbl,
}

/// O começo de `AMFDataVtbl` (`core/Data.h`), comum ao `AMFSurface` e ao `AMFBuffer`.
#[repr(C)]
pub struct DataVtbl {
    pub storage: StorageVtbl,
    // GetMemoryType, Duplicate, Convert, Interop, GetDataType, IsReusable
    _memory: [usize; 6],
    pub set_pts: unsafe extern "system" fn(*mut c_void, i64),
    pub get_pts: unsafe extern "system" fn(*mut c_void) -> i64,
    pub set_duration: unsafe extern "system" fn(*mut c_void, i64),
    // GetDuration
    _get_duration: usize,
}

/// Um `AMFData` qualquer: o que o `QueryOutput` devolve (um `AMFBuffer`, no encoder).
#[repr(C)]
pub struct Data {
    pub vtbl: *const DataVtbl,
}

/// `AMFSurfaceVtbl` (`core/Surface.h`): o app só usa a parte de `AMFData`.
#[repr(C)]
pub struct Surface {
    pub vtbl: *const DataVtbl,
}

/// `AMFBufferVtbl` (`core/Buffer.h`).
#[repr(C)]
pub struct BufferVtbl {
    pub data: DataVtbl,
    // SetSize
    _set_size: usize,
    pub get_size: unsafe extern "system" fn(*mut Buffer) -> usize,
    pub get_native: unsafe extern "system" fn(*mut Buffer) -> *mut c_void,
}

#[repr(C)]
pub struct Buffer {
    pub vtbl: *const BufferVtbl,
}

// --- a DLL ---------------------------------------------------------------------------------------

/// A fábrica do AMF, que vive enquanto o processo viver (a DLL nunca é descarregada).
struct Loaded(*mut Factory);

// SAFETY: a fábrica do AMF é um objeto global da DLL, feito para ser usado de qualquer thread
// (o SDK chama `AMFInit` uma vez por processo); o ponteiro nunca é solto.
unsafe impl Send for Loaded {}
// SAFETY: idem.
unsafe impl Sync for Loaded {}

static FACTORY: OnceLock<Result<Loaded, String>> = OnceLock::new();

type AmfInitFn = unsafe extern "C" fn(u64, *mut *mut Factory) -> AmfResult;

/// A fábrica do AMF. Falha sem o driver da AMD (a DLL não existe) ou com um driver velho demais.
pub fn factory() -> Result<*mut Factory, AppError> {
    let loaded = FACTORY.get_or_init(|| {
        step("LoadLibrary amfrt64.dll");
        let name: Vec<u16> = "amfrt64.dll\0".encode_utf16().collect();
        // SAFETY: o nome termina em zero; carregar uma DLL do sistema pelo nome é seguro.
        let module = unsafe { LoadLibraryW(name.as_ptr()) };
        if module.is_null() {
            return Err("amfrt64.dll não encontrada (sem driver da AMD)".into());
        }
        // SAFETY: `module` é válido e o nome da função termina em zero.
        let Some(init) = (unsafe { GetProcAddress(module, c"AMFInit".as_ptr().cast()) }) else {
            return Err("amfrt64.dll sem AMFInit".into());
        };
        // SAFETY: `AMFInit` tem a assinatura de `AMFInit_Fn` (`core/Factory.h`).
        let init: AmfInitFn = unsafe { std::mem::transmute(init) };
        let mut factory = std::ptr::null_mut();
        step("AMFInit");
        // SAFETY: o ponteiro de saída é uma variável local viva.
        let result = unsafe { init(AMF_VERSION_1_4, &mut factory) };
        if result != AMF_OK || factory.is_null() {
            return Err(format!("AMFInit falhou ({result})"));
        }
        step("AMFInit ok");
        Ok(Loaded(factory))
    });
    match loaded {
        Ok(loaded) => Ok(loaded.0),
        Err(error) => Err(AppError::VideoCapture(error.clone())),
    }
}

/// Um passo da conversa com o AMF, no nível `debug` do alvo `amf`. O `amf-probe` mostra todos: se
/// o processo cair, o último passo no terminal diz qual chamada derrubou.
pub fn step(what: &str) {
    tracing::debug!(target: "amf", "{what}");
}

/// Erro de uma chamada do AMF, com o nome dela.
pub fn check(what: &str, result: AmfResult) -> Result<(), AppError> {
    if result == AMF_OK {
        Ok(())
    } else {
        Err(AppError::VideoCapture(format!(
            "{what}: AMF_RESULT {result}"
        )))
    }
}

/// Uma referência do AMF que é solta (`Release`) quando sai de escopo. `T` é uma das structs com
/// `vtbl` aqui de cima, cujo vtable começa pelo [`StorageVtbl`].
pub struct Ref<T> {
    ptr: *mut T,
}

impl<T> Ref<T> {
    /// # Safety
    ///
    /// `ptr` é um objeto do AMF vivo, com uma referência que passa a ser desta `Ref`, e o vtable
    /// dele começa pelo [`StorageVtbl`].
    pub unsafe fn new(ptr: *mut T) -> Option<Self> {
        if ptr.is_null() {
            return None;
        }
        // Um objeto sem vtable não é um objeto do AMF: chamar qualquer função dele derruba o app
        // (visto na transmissão pelo AMF, logo depois de abrir o encoder). Fica de fora, e o
        // log diz qual chamada devolveu isso.
        // SAFETY: `ptr` não é nulo e, pelo contrato, aponta para um objeto que começa por um
        // ponteiro.
        if unsafe { *(ptr as *const *const c_void) }.is_null() {
            tracing::warn!(target: "media", tipo = std::any::type_name::<T>(), "o AMF devolveu um objeto sem vtable; ignorado");
            return None;
        }
        Some(Self { ptr })
    }

    pub fn as_ptr(&self) -> *mut T {
        self.ptr
    }

    fn storage(&self) -> &StorageVtbl {
        // SAFETY: pelo contrato de `new`, o objeto começa pelo ponteiro para um vtable que começa
        // pelo `StorageVtbl`.
        unsafe { &**(self.ptr as *const *const StorageVtbl) }
    }

    /// `SetProperty` de um `AMFPropertyStorage`.
    pub fn set(&self, name: PCWSTR, value: AmfVariant) -> AmfResult {
        // SAFETY: o objeto é vivo e o nome é um texto largo terminado em zero (`w!`).
        unsafe { (self.storage().set_property)(self.ptr.cast(), name, value) }
    }

    /// `GetProperty` de um `AMFPropertyStorage`.
    pub fn get(&self, name: PCWSTR) -> Option<AmfVariant> {
        let mut value = AmfVariant::empty();
        // SAFETY: o objeto é vivo, o nome termina em zero e `value` é local.
        let result = unsafe { (self.storage().get_property)(self.ptr.cast(), name, &mut value) };
        (result == AMF_OK).then_some(value)
    }

    /// `QueryInterface` para outra interface do mesmo objeto.
    pub fn query<U>(&self, iid: &GUID) -> Option<Ref<U>> {
        let mut out = std::ptr::null_mut();
        // SAFETY: o objeto é vivo; o `QueryInterface` devolve uma referência nova (ou nada).
        let result = unsafe { (self.storage().query_interface)(self.ptr.cast(), iid, &mut out) };
        if result != AMF_OK {
            return None;
        }
        // SAFETY: a referência nova é desta `Ref`, e toda interface do AMF começa pelo storage.
        unsafe { Ref::new(out.cast()) }
    }
}

impl<T> Drop for Ref<T> {
    fn drop(&mut self) {
        // SAFETY: a `Ref` tem uma referência do objeto, solta uma única vez aqui.
        unsafe { (self.storage().release)(self.ptr.cast()) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_variant_tem_o_tamanho_do_sdk() {
        // `AMF_VARIANT_TYPE` (4) + 4 de alinhamento + o union de 16.
        assert_eq!(std::mem::size_of::<AmfVariant>(), 24);
        assert_eq!(std::mem::align_of::<AmfVariant>(), 8);
    }

    #[test]
    fn as_vtables_tem_o_numero_de_funcoes_dos_cabecalhos() {
        let slot = std::mem::size_of::<usize>();
        assert_eq!(std::mem::size_of::<FactoryVtbl>(), 7 * slot);
        assert_eq!(std::mem::size_of::<StorageVtbl>(), 13 * slot);
        // CreateSurfaceFromDX11Native é a 50ª função do contexto.
        assert_eq!(std::mem::size_of::<ContextVtbl>(), 50 * slot);
        // O cabeçalho lista 30, mas 2 são o GetPropertyInfo/GetPropertyInfoAt repetidos no `#if _WIN32`.
        assert_eq!(std::mem::size_of::<ComponentVtbl>(), 28 * slot);
        assert_eq!(std::mem::size_of::<DataVtbl>(), 23 * slot);
        assert_eq!(std::mem::size_of::<BufferVtbl>(), 26 * slot);
    }

    #[test]
    fn rate_e_size_guardam_os_dois_numeros_na_ordem_do_sdk() {
        let rate = AmfVariant::rate(60, 1);
        assert_eq!(rate.value[0] & 0xFFFF_FFFF, 60);
        assert_eq!(rate.value[0] >> 32, 1);
        assert_eq!(AmfVariant::int(-1).as_int(), Some(-1));
        assert_eq!(AmfVariant::bool(true).as_int(), None);
    }
}
