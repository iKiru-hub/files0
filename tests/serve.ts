import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from '../webserver/server.js';
const directory = process.env.FILES0_TEST_DIRECTORY!;
await mkdir(directory, { recursive: true });
await rm(join(directory, '.files0-library.json'), { force: true });
await writeFile(join(directory, 'test.txt'), '@idea\nOne small thought.\n#to next\n@next\nIt leads somewhere.\n#border none\n@class vehicle\n-- wheels\n@class car\n#inherit vehicle');
await copyFile('vsfiles/hello.graph', join(directory, 'hello.graph'));
await writeFile(join(directory, 'constants.yaml'), 'note_width: 100px');
const { app, store } = await createApp(directory, join(directory, 'constants.yaml'));
const server = createServer(app).listen(3177, '127.0.0.1');
// Test-only fault injection: close the actual event-stream socket. Browser offline
// emulation can leave already-established localhost streams connected.
app.post('/__test__/disconnect', (_req, res) => {
  res.sendStatus(204);
  setTimeout(() => server.closeAllConnections(), 20);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { store.close(); server.close(); server.closeAllConnections(); });
