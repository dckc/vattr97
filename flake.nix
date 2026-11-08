{
  description = "vattr97: toybox, a kernel for vats whose code is installed at runtime, on workerd";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      inherit (pkgs) lib;
      yarn-berry = pkgs.yarn-berry_4;

      # nixpkgs has no workerd of its own; wrangler carries a patched one.
      # It must be at least the compatibility date in
      # packages/toybox/config.capnp.
      workerdVersion = "1.20261006.1";
      workerd = pkgs.runCommand "workerd-${workerdVersion}" { } ''
        bin=${pkgs.wrangler}/lib/node_modules/.pnpm/@cloudflare+workerd-linux-64@${workerdVersion}/node_modules/@cloudflare/workerd-linux-64/bin/workerd
        test -x $bin || { echo "no workerd ${workerdVersion} in ${pkgs.wrangler}" >&2; exit 1; }
        mkdir -p $out/bin
        ln -s $bin $out/bin/workerd
      '';

      # the workspace's manifests (yarn installs for all of it), and toybox
      src = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.unions [
          ./package.json
          ./yarn.lock
          ./.yarnrc.yml
          (lib.fileset.fileFilter (f: f.name == "package.json") ./packages)
          ./packages/toybox
        ];
      };

      # unit files for hosts that aren't NixOS; see nix/units.nix for the options
      toyboxUnits =
        options:
        let
          rendered = import ./nix/render-units.nix { inherit lib pkgs; } (
            import ./nix/units.nix ({ inherit lib; } // options)
          );
        in
        pkgs.runCommand "toybox-units" { } ''
          mkdir -p $out/lib/systemd/system
          ${lib.concatStrings (
            lib.mapAttrsToList (name: file: "cp ${file} $out/lib/systemd/system/${name}\n") rendered
          )}
        '';

      toybox = pkgs.stdenv.mkDerivation (finalAttrs: {
        pname = "toybox";
        version = "0.0.0";
        inherit src;

        nativeBuildInputs = [
          pkgs.nodejs
          yarn-berry
          yarn-berry.yarnBerryConfigHook
        ];
        # toybox needs no install scripts: esbuild finds its platform binary
        # itself, workerd is the one above, and ertp-books' better-sqlite3
        # isn't used here
        env.YARN_ENABLE_SCRIPTS = "false";
        missingHashes = ./missing-hashes.json;
        offlineCache = yarn-berry.fetchYarnBerryDeps {
          inherit (finalAttrs) src missingHashes;
          hash = "sha256-vm9l5QKejnbUWHCWPbNZOVB41+OClDCnypXUy/L95Zo=";
        };

        buildPhase = ''
          runHook preBuild
          (cd packages/toybox && node build.js)
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          share=$out/share/toybox
          mkdir -p $share $out/bin
          cp -r packages/toybox/dist packages/toybox/config.capnp $share/
          # the boot directory the units use by default
          cp -r packages/toybox/examples/wallet $share/boot
          cat > $out/bin/toybox-serve <<SH
          #!${pkgs.runtimeShell}
          exec ${workerd}/bin/workerd serve --experimental $share/config.capnp "\$@"
          SH
          chmod +x $out/bin/toybox-serve
          # as installed in the nix profile /nix/var/nix/profiles/toybox, a
          # path that survives upgrades
          cp -r ${toyboxUnits { bin = "/nix/var/nix/profiles/toybox/bin"; }}/lib $out/
          runHook postInstall
        '';
      });
    in
    {
      packages.${system} = {
        default = toybox;
        inherit toybox workerd;
      };

      # unit files with options of your own (nix/units.nix): a user, a git
      # checkout, a state directory, a port
      lib.${system} = { inherit toyboxUnits; };

      nixosModules.toybox =
        { lib, ... }:
        {
          imports = [ ./nix/module.nix ];
          services.toybox.package = lib.mkDefault toybox;
        };

      checks.${system} = {
        inherit toybox;
        # the module evaluates, and its service reads the checkout it was given as that user
        module =
          let
            nixos = nixpkgs.lib.nixosSystem {
              inherit system;
              modules = [
                self.nixosModules.toybox
                {
                  services.toybox = {
                    enable = true;
                    user = "alice";
                    gitCheckout = "/home/alice/checkout";
                  };
                  boot.isContainer = true;
                  system.stateVersion = "26.05";
                }
              ];
            };
            service = nixos.config.systemd.services.toybox.serviceConfig;
          in
          assert service.User == "alice";
          assert service.ProtectHome == "read-only";
          assert lib.hasInfix "-d git-checkout=/home/alice/checkout" service.ExecStart;
          assert lib.hasInfix "-S app=5 " service.ExecStart;
          assert lib.hasInfix "/share/toybox/boot" service.ExecStart;
          assert service.PrivateNetwork;
          pkgs.writeText "toybox-module-check" (builtins.toJSON service);
        # a checkout without a user to read it is refused
        module-needs-user =
          let
            nixos = nixpkgs.lib.nixosSystem {
              inherit system;
              modules = [
                self.nixosModules.toybox
                {
                  services.toybox = {
                    enable = true;
                    gitCheckout = "/home/alice/checkout";
                  };
                  boot.isContainer = true;
                  system.stateVersion = "26.05";
                }
              ];
            };
            failed = lib.filter (a: !a.assertion) nixos.config.assertions;
          in
          assert lib.any (a: lib.hasPrefix "services.toybox:" a.message) failed;
          pkgs.writeText "toybox-module-needs-user-check" "";
      };
    };
}
