# Unit files from units.nix's attrsets: what NixOS would write, for hosts
# that aren't NixOS.
{ lib, pkgs }:
units:
let
  value = v: if v == true then "yes" else if v == false then "no" else toString v;
  section = name: attrs:
    "[${name}]\n"
    + lib.concatStrings (
      lib.mapAttrsToList (
        k: v: lib.concatMapStrings (x: "${k}=${value x}\n") (lib.toList v)
      ) attrs
    );
  unit = u: {
    Description = u.description;
  }
  // lib.optionalAttrs (u ? requires) { Requires = lib.concatStringsSep " " u.requires; }
  // lib.optionalAttrs (u ? after) { After = lib.concatStringsSep " " u.after; };
  install = u: lib.optionalString (u ? wantedBy) (
    "\n" + section "Install" { WantedBy = lib.concatStringsSep " " u.wantedBy; }
  );
  socket = name: u:
    pkgs.writeText "${name}.socket" (
      section "Unit" (unit u)
      + "\n"
      + section "Socket" ({ ListenStream = u.listenStreams; } // u.socketConfig)
      + install u
    );
  service = name: u:
    pkgs.writeText "${name}.service" (section "Unit" (unit u) + "\n" + section "Service" u.serviceConfig + install u);
in
lib.mapAttrs' (n: u: lib.nameValuePair "${n}.socket" (socket n u)) units.sockets
// lib.mapAttrs' (n: u: lib.nameValuePair "${n}.service" (service n u)) units.services
