//! A busca protegida da prévia de links (decisão 23 do plano da v0.7): a VPS passa a acessar os
//! sites que alguém manda no chat, então ela só vai a endereços públicos.
//!
//! - só `http` e `https`, nas portas 80 e 443;
//! - o nome é resolvido aqui, e a conexão vai para o IP conferido (sem uma segunda resolução que
//!   um DNS malicioso poderia trocar por um endereço interno);
//! - nenhum endereço privado, de loopback, link-local, reservado nem da própria VPS;
//! - cada redirecionamento (até 3) passa pela mesma conferência;
//! - tempo e tamanho limitados.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use reqwest::Url;
use reqwest::header::{CONTENT_TYPE, LOCATION};

/// O `User-Agent` das buscas: diz o que é, para o site saber.
pub const USER_AGENT: &str = "AshtarLinkPreview/1.0 (+prévia de links de um chat privado)";
/// Quantos redirecionamentos seguir.
pub const MAX_REDIRECTS: usize = 3;
/// O tempo de uma busca inteira, com os redirecionamentos.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

/// As regras de uma busca. Os testes confiam no servidor local deles (`trusted`); a API de
/// verdade não confia em nada.
#[derive(Debug, Clone, Default)]
pub struct Guard {
    /// Endereços que passam sem a conferência (só nos testes).
    pub trusted: Vec<SocketAddr>,
    /// Os endereços da própria VPS, além dos privados.
    pub own: Vec<IpAddr>,
}

/// Por que a busca não aconteceu (vai só para o log).
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    Scheme,
    Port,
    Address(IpAddr),
    Dns,
    TooManyRedirects,
    Status(u16),
    ContentType(String),
    TooLarge,
    Timeout,
    Network(String),
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

/// Se o endereço é público (o `is_global` do Rust ainda não é estável).
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // fc00::/7, os endereços locais únicos
                || (s[0] & 0xfe00) == 0xfc00
                // fe80::/10, link-local
                || (s[0] & 0xffc0) == 0xfe80
                // 2001:db8::/32, documentação
                || (s[0] == 0x2001 && s[1] == 0x0db8)
                // 64:ff9b::/96, o NAT64 (pode esconder um IPv4 interno)
                || (s[0] == 0x0064 && s[1] == 0xff9b)
                // ::/96, o IPv4 compatível antigo
                || (s[0..6] == [0; 6]))
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || a == 0
        // 100.64.0.0/10, o NAT das operadoras
        || (a == 100 && (64..128).contains(&b))
        // 192.0.0.0/24
        || (a == 192 && b == 0 && c == 0)
        // 198.18.0.0/15, testes de rede
        || (a == 198 && (b == 18 || b == 19))
        // 240.0.0.0/4, reservado
        || a >= 240)
}

impl Guard {
    /// O endereço para onde a busca de `url` pode ir, ou o motivo de não ir.
    async fn target(&self, url: &Url) -> Result<SocketAddr, Refused> {
        if !matches!(url.scheme(), "http" | "https") {
            return Err(Refused::Scheme);
        }
        let port = url.port_or_known_default().ok_or(Refused::Port)?;
        let host = url.host_str().ok_or(Refused::Dns)?;
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| Refused::Dns)?
            .collect();
        // O IPv4 antes: o contêiner da VPS pode não ter rota para IPv6.
        let first = *addrs
            .iter()
            .find(|addr| addr.is_ipv4())
            .or(addrs.first())
            .ok_or(Refused::Dns)?;
        if addrs.iter().all(|addr| self.trusted.contains(addr)) {
            return Ok(first);
        }
        if port != 80 && port != 443 {
            return Err(Refused::Port);
        }
        // Todos os endereços do nome têm de ser públicos: o cliente poderia usar qualquer um.
        for addr in &addrs {
            let ip = addr.ip();
            if !is_public(ip) || self.own.contains(&ip) {
                return Err(Refused::Address(ip));
            }
        }
        Ok(first)
    }

    /// Busca `url` (seguindo até 3 redirecionamentos conferidos) e devolve o endereço final, o
    /// tipo e até `max_bytes` do corpo. `cut`: passou do tamanho, corta (o HTML) em vez de recusar
    /// (a imagem).
    pub async fn get(
        &self,
        url: Url,
        accept: fn(&str) -> bool,
        max_bytes: usize,
        cut: bool,
    ) -> Result<(Url, String, Vec<u8>), Refused> {
        tokio::time::timeout(FETCH_TIMEOUT, self.get_inner(url, accept, max_bytes, cut))
            .await
            .map_err(|_| Refused::Timeout)?
    }

    async fn get_inner(
        &self,
        mut url: Url,
        accept: fn(&str) -> bool,
        max_bytes: usize,
        cut: bool,
    ) -> Result<(Url, String, Vec<u8>), Refused> {
        for _ in 0..=MAX_REDIRECTS {
            let addr = self.target(&url).await?;
            let host = url.host_str().ok_or(Refused::Dns)?.to_owned();
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(USER_AGENT)
                .timeout(FETCH_TIMEOUT)
                .resolve(&host, addr)
                .no_proxy()
                .build()
                .map_err(|error| Refused::Network(error.to_string()))?;
            let mut response = client
                .get(url.clone())
                .header("Accept", "text/html,application/json,image/*;q=0.8")
                .send()
                .await
                .map_err(|error| Refused::Network(error.to_string()))?;
            let status = response.status();
            if status.is_redirection() {
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or(Refused::Status(status.as_u16()))?;
                url = url
                    .join(location)
                    .map_err(|_| Refused::Status(status.as_u16()))?;
                continue;
            }
            if !status.is_success() {
                return Err(Refused::Status(status.as_u16()));
            }
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|v| {
                    v.split(';')
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_ascii_lowercase()
                })
                .unwrap_or_default();
            if !accept(&content_type) {
                return Err(Refused::ContentType(content_type));
            }
            if !cut
                && response
                    .content_length()
                    .is_some_and(|n| n as usize > max_bytes)
            {
                return Err(Refused::TooLarge);
            }
            let mut body = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|error| Refused::Network(error.to_string()))?
            {
                body.extend_from_slice(&chunk);
                if body.len() > max_bytes {
                    if !cut {
                        return Err(Refused::TooLarge);
                    }
                    body.truncate(max_bytes);
                    break;
                }
            }
            return Ok((url, content_type, body));
        }
        Err(Refused::TooManyRedirects)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn so_o_que_e_publico() {
        for public in ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "::ffff:8.8.8.8"] {
            assert!(is_public(public.parse().unwrap()), "{public}");
        }
        for private in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.5.4",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.1",
            "198.18.0.1",
            "::1",
            "::",
            "fe80::1",
            "fd00::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
            "::7f00:1",
        ] {
            assert!(!is_public(private.parse().unwrap()), "{private}");
        }
    }

    #[tokio::test]
    async fn recusa_o_esquema_a_porta_e_o_endereco_interno() {
        let guard = Guard::default();
        let target = |u: &str| {
            let guard = guard.clone();
            let url = Url::parse(u).unwrap();
            async move { guard.target(&url).await }
        };
        assert_eq!(target("ftp://exemplo.com/").await, Err(Refused::Scheme));
        assert_eq!(target("file:///etc/passwd").await, Err(Refused::Scheme));
        assert_eq!(target("http://8.8.8.8:8080/").await, Err(Refused::Port));
        assert!(matches!(
            target("http://127.0.0.1/").await,
            Err(Refused::Address(_))
        ));
        assert!(matches!(
            target("http://[::1]/").await,
            Err(Refused::Address(_))
        ));
        assert!(matches!(
            target("http://localhost/").await,
            Err(Refused::Address(_))
        ));
        assert!(matches!(
            target("http://169.254.169.254/latest/meta-data").await,
            Err(Refused::Address(_))
        ));
        let own = Guard {
            own: vec!["8.8.8.8".parse().unwrap()],
            ..Guard::default()
        };
        assert!(matches!(
            own.target(&Url::parse("http://8.8.8.8/").unwrap()).await,
            Err(Refused::Address(_))
        ));
        assert!(
            Guard::default()
                .target(&Url::parse("https://8.8.8.8/").unwrap())
                .await
                .is_ok()
        );
    }
}
