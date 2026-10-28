#!/usr/bin/env bash
# Aponta o canal beta (release fixo `beta` do ashtar-releases) para a versão $VERSION.
# Copia o latest.json do release v$VERSION para o release `beta`, criando-o se faltar.
# Precisa de: VERSION, RELEASES_REPO e GH_TOKEN. Seguro de rodar mais de uma vez.
set -euo pipefail

rm -rf beta
gh release download "v$VERSION" --repo "$RELEASES_REPO" --pattern latest.json --dir beta

if ! saida=$(gh release view beta --repo "$RELEASES_REPO" 2>&1); then
  if grep -qi "release not found" <<< "$saida"; then
    gh release create beta --repo "$RELEASES_REPO" --target main --prerelease \
      --title "Canal beta" --notes "Manifesto do canal beta. Não instale daqui."
  else
    echo "::error::não foi possível consultar o release beta: $saida"
    exit 1
  fi
fi

gh release upload beta beta/latest.json --repo "$RELEASES_REPO" --clobber
