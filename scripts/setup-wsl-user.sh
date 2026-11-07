#!/usr/bin/env bash
# Run as your normal user inside WSL Ubuntu, after setup-wsl-root.sh.
set -euo pipefail

AGAVE=v4.4.1
ANCHOR=0.32.3
TOOLS=v1.57

cat > "$HOME/.cubby_env" <<'EOF'
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
EOF
grep -q cubby_env "$HOME/.bashrc" || sed -i '1i . "$HOME/.cubby_env"' "$HOME/.bashrc"
. "$HOME/.cubby_env"

rustup default stable

# Solana CLI from the official Agave release
SOL="$HOME/.local/share/solana/install"
if [ ! -x "$SOL/releases/$AGAVE/solana-release/bin/solana" ]; then
  mkdir -p "$SOL/releases/$AGAVE"
  curl -sSfL "https://github.com/anza-xyz/agave/releases/download/$AGAVE/solana-release-x86_64-unknown-linux-gnu.tar.bz2" \
    | tar xj -C "$SOL/releases/$AGAVE"
fi
ln -sfn "$SOL/releases/$AGAVE/solana-release" "$SOL/active_release"

# Anchor CLI binary
mkdir -p "$HOME/.local/bin"
curl -sSfL -o "$HOME/.local/bin/anchor" \
  "https://github.com/solana-foundation/anchor/releases/download/v$ANCHOR/anchor-$ANCHOR-x86_64-unknown-linux-gnu"
chmod +x "$HOME/.local/bin/anchor"

# Platform tools (cargo-build-sbf's own downloader is flaky, so fetch directly)
PT="$HOME/.cache/solana/$TOOLS/platform-tools"
if [ ! -f "$PT/version.md" ]; then
  mkdir -p "$PT"
  curl -sSfL --retry 5 "https://github.com/anza-xyz/platform-tools/releases/download/$TOOLS/platform-tools-linux-x86_64.tar.bz2" \
    | tar xj -C "$PT"
fi

solana --version
anchor --version
echo "USER_SETUP_OK"
