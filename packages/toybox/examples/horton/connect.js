/**
 * @file Horton's base case: a first secure path from one party's app
 * object to another's, made by someone who holds both parties' Horton
 * roots. Each new path after that is Horton's inductive case.
 */

/** @import { Powers, Remote } from '../../src/types.js' */

/**
 * A proxy that `importer`'s app objects can use to reach `target`, an
 * object of `exporter`'s: `importer` blames `exporter` for its service,
 * and `exporter` blames `importer` for the requests. Each knows the other
 * by the pet name given.
 *
 * @param {Powers['E']} E
 * @param {{ horton: Remote, petName: string }} exporter
 * @param {{ horton: Remote, petName: string }} importer
 * @param {Remote} target
 */
export const connect = async (E, exporter, importer, target) => {
  const whoExporter = await E(exporter.horton).getWho();
  const whoImporter = await E(importer.horton).getWho();
  await E(exporter.horton).setPetName(whoImporter, importer.petName);
  await E(importer.horton).setPetName(whoExporter, exporter.petName);
  const stub = await E(exporter.horton).makeStub(whoImporter, target);
  return E(importer.horton).makeProxy(whoExporter, stub);
};
