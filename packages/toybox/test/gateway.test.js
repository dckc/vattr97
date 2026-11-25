/** @file The wallet's gateway, in one process: what the boot vat equips it with, at each start, and what the owner's host names of it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, Far } from '@endo/far';
import { M } from '@endo/patterns';
import { hashes } from '../src/hashes.js';
import { makeLiveslots } from '../src/vat/liveslots.js';
import { buildRootObject } from '../examples/wallet/gateway/gateway.js';
import { isSwissNum } from '../examples/wallet/gateway/registry.exo.js';
import { makeMemoryVatstore } from './memory-vatstore.js';

/**
 * @import { Remote, SqlDatabase } from '../src/types.js';
 * @import { Definer } from '../examples/wallet/gateway/agents.exo.js';
 */

/** The swiss number in an agent's link. @param {string} link */
const swissOf = link => {
  const [, swiss] = link.match(/^#agent=(.*)$/) ?? [];
  if (!isSwissNum(swiss)) throw Error(`not an agent's link: ${link}`);
  return swiss;
};

/** A durable zone of its own, over an in-memory vatstore. */
const makeZone = () => {
  const send = () => Promise.reject(Error('this gateway imports nothing'));
  const { zone } = makeLiveslots({ send, kv: makeMemoryVatstore() });
  assert.ok(zone);
  return zone;
};

test("an owner's host made before the gateway was equipped gets the owner's starters once; a name the owner forgets stays forgotten", async () => {
  const zone = makeZone();
  let n = 0;
  const entropy = zone.exo('Entropy', undefined, {
    swiss: () => {
      const swiss = `${(n += 1)}`.padStart(22, 'A');
      if (!isSwissNum(swiss)) throw Error('not a swiss number');
      return swiss;
    },
  });
  const counters = zone.exo('Counters', undefined, {});
  const stores = zone.exo('Stores', undefined, {});
  const definer =
    /** @type {Remote<Definer>} the gateway never runs it here */ (
      zone.exo('Definer', undefined, {})
    );
  const ingress = zone.exo('Ingress', undefined, { serve: () => {} });
  const db = /** @type {SqlDatabase} the gateway uses none */ (harden({}));
  const endowment = () => {
    throw Error('no endowments here');
  };
  const gateway = buildRootObject(
    harden({ E, Far, M, zone, hashes, db, endowment }),
    {
      ingress,
      entropy,
      starters: { counters },
    },
  );
  const ownerNames = async () => {
    const link = await gateway.provideOwnerLink();
    const { nameHub } = gateway.agents().deref(swissOf(link));
    return [...nameHub.keys()].sort();
  };

  assert.deepEqual(await ownerNames(), ['counters'], 'not yet equipped');
  gateway.equip({ definer, ownerStarters: { stores } });
  assert.deepEqual(await ownerNames(), ['counters', 'stores']);

  const link = await gateway.provideOwnerLink();
  const { nameAdmin } = gateway.agents().deref(swissOf(link));
  nameAdmin.delete('stores');
  // the next start equips it again
  gateway.equip({ definer, ownerStarters: { stores } });
  assert.deepEqual(await ownerNames(), ['counters'], 'stays forgotten');
});
