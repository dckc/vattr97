import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const endoRoot =
  process.env.ENDO_ROOT ?? path.join(os.homedir(), 'projects', 'endo');
/** @param {string[]} parts */
const endoModule = (...parts) =>
  url.pathToFileURL(path.join(endoRoot, 'packages', ...parts)).href;

await import(endoModule('init', 'index.js'));

const [
  { makeArchive },
  { makeReadPowers },
  { defaultParserForLanguage },
  { bytesReaderFromIterator },
  { E },
  { makeEndoClient, start },
  { makeCancelKit },
  { whereEndoSock },
] = await Promise.all([
  import(endoModule('compartment-mapper', 'index.js')),
  import(endoModule('compartment-mapper', 'node-powers.js')),
  import(endoModule('compartment-mapper', 'import-parsers.js')),
  import(endoModule('exo-stream', 'bytes-reader-from-iterator.js')),
  import(endoModule('eventual-send', 'src', 'no-shim.js')),
  import(endoModule('daemon', 'index.js')),
  import(endoModule('cancel', 'index.js')),
  import(endoModule('where', 'index.js')),
]);

const packageRoot = url.fileURLToPath(new URL('..', import.meta.url));
const sqliteModule = url.pathToFileURL(
  path.resolve(packageRoot, '../sqlite-plugin/src/sqlite-db.js'),
).href;
const confinedModule = path.join(packageRoot, 'src', 'confined-store.js');
const databasePath =
  process.env.DB_PATH ?? path.join(os.tmpdir(), 'vattr97.sqlite');

const { cancelled, cancel } = makeCancelKit();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGQUIT']) {
  process.once(signal, () => cancel(Error(signal)));
}

const { username, homedir } = os.userInfo();
const sockPath = whereEndoSock(process.platform, process.env, {
  user: username,
  home: homedir,
  temp: os.tmpdir(),
});

const connect = () =>
  makeEndoClient(
    'ertp-dacct-compose',
    sockPath,
    cancelled,
    undefined,
    harden({ onReject: () => {} }),
  );

let client;
try {
  client = await connect();
} catch {
  await start().catch(() => {});
  client = await connect();
}

const { getBootstrap, closed } = client;
const bootstrap = getBootstrap();
const host = E(bootstrap).host();
const archiveName = `tmp-confined-store-${crypto.randomBytes(8).toString('hex')}`;

try {
  const dbMaker = await E(host).makeUnconfined('@node', sqliteModule, {
    powersName: ['@none'],
  });
  const db = await E(dbMaker).makeDb(databasePath);
  await E(host).storeValue(db, ['sqlite-db']);

  const readPowers = makeReadPowers({ fs, url, crypto, path });
  const archiveBytes = await makeArchive(
    readPowers,
    url.pathToFileURL(confinedModule).href,
    { parserForLanguage: defaultParserForLanguage },
  );
  await E(host).storeBlob(bytesReaderFromIterator([archiveBytes]), archiveName);

  const store = await E(host).makeArchive(undefined, archiveName, {
    powersName: ['@agent'],
    resultName: ['confined-store'],
  });
  await E(store).set('answer', '42');
  console.log(await E(store).get('answer'));
} finally {
  await E(host)
    .remove(archiveName)
    .catch(() => {});
  cancel(Error('normal termination'));
  await closed.catch(() => {});
}
