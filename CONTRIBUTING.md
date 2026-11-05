# Contributing

Thanks for your interest in contributing!

## Contributor License Agreement

Contributions to this repository are expected to be subject to an agreement much like the [Apache Software Foundation Contributor Agreements](https://www.apache.org/licenses/contributor-agreements.html):

- [ICLA: Individual Contributor License Agreement](https://www.apache.org/licenses/icla.pdf)
- [CCLA: Corporate Contributor License Agreement](https://www.apache.org/licenses/cla-corporate.pdf)

_**Meanwhile, stay tuned to [Contributor License Agreement details #7](https://github.com/dckc/vattr97/issues/7).**_

## Changing dependencies

A change to yarn.lock changes the [flake](flake.nix)'s hash of the JS dependencies, so `nix flake check` fails until it's updated: rerun `nix build .#toybox`, and take the hash it reports into flake.nix (and missing-hashes.json, from `yarn-berry-fetcher missing-hashes yarn.lock`). Keep yarn.lock, and that hash, in a commit of their own.
