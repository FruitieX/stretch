{
  description = "Stretch: reminders to keep moving during the workday";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = {self, nixpkgs}: let
    systems = ["x86_64-linux" "aarch64-linux"];
    each = nixpkgs.lib.genAttrs systems;
    build = system: let
      pkgs = import nixpkgs {inherit system;};
      frontend = pkgs.buildNpmPackage {
        pname = "stretch-ui"; version = "0.1.0"; nodejs = pkgs.nodejs_26;
        src = pkgs.lib.cleanSourceWith {src = ./.; filter = path: type: !(builtins.elem (baseNameOf path) ["node_modules" "target" "dist" ".git" "data" "test-results" "result" "backend" "docs" ".github" "flake.nix" "flake.lock"]);};
        # Read from package-lock.json, so dependency updates need no hash bump.
        npmDeps = pkgs.importNpmLock { npmRoot = ./.; };
        npmConfigHook = pkgs.importNpmLock.npmConfigHook;
        installPhase = ''mkdir -p $out/share/stretch; cp -r dist/. $out/share/stretch/'';
      };
      backend = pkgs.rustPlatform.buildRustPackage {
        pname = "stretch-api"; version = "0.1.0";
        src = pkgs.lib.cleanSourceWith {src = ./backend; filter = path: type: baseNameOf path != "target";};
        cargoLock.lockFile = ./backend/Cargo.lock;
      };
    in {inherit pkgs frontend backend;};
  in {
    packages = each (system: let inherit (build system) pkgs frontend backend; in {
      inherit frontend backend; default = backend;
      container = pkgs.dockerTools.buildLayeredImage {
        name = "ghcr.io/fruitiex/stretch"; tag = "main";
        contents = [backend frontend pkgs.cacert pkgs.tzdata pkgs.coreutils];
        extraCommands = ''mkdir -p data tmp; chmod 1777 tmp'';
        fakeRootCommands = ''chown 10001:10001 data'';
        config = {
          User = "10001:10001"; WorkingDir = "/";
          Entrypoint = ["${backend}/bin/stretch-api"];
          Env = ["STRETCH_BIND=0.0.0.0:8080" "STRETCH_DATA_DIR=/data" "STRETCH_STATIC_DIR=${frontend}/share/stretch" "TZDIR=${pkgs.tzdata}/share/zoneinfo"];
          ExposedPorts."8080/tcp" = {}; Volumes."/data" = {};
        };
      };
    });
    devShells = each (system: let pkgs = (build system).pkgs; in {default = pkgs.mkShell {
      packages = with pkgs; [nodejs_26 cargo rustc rustfmt clippy gcc pkg-config chromium];
      shellHook = ''export PLAYWRIGHT_CHROMIUM_EXECUTABLE=${pkgs.chromium}/bin/chromium'';
    };});
  };
}
