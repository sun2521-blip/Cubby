#!/usr/bin/env bash
# Run as root inside WSL Ubuntu: wsl -d Ubuntu -u root --exec bash scripts/setup-wsl-root.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Some networks break IPv6 / DNS inside WSL. Force IPv4 for apt and use Google DNS.
echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4
if ! grep -q generateResolvConf /etc/wsl.conf 2>/dev/null; then
  printf "\n[network]\ngenerateResolvConf = false\n" >> /etc/wsl.conf
  rm -f /etc/resolv.conf
  printf "nameserver 8.8.8.8\nnameserver 8.8.4.4\noptions timeout:2 attempts:2\n" > /etc/resolv.conf
fi

apt-get update -y
apt-get install -y build-essential pkg-config libudev-dev llvm libclang-dev \
  protobuf-compiler libssl-dev curl git ca-certificates rustup nodejs npm
echo "ROOT_DEPS_OK"
