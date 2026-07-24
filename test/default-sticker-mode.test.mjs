import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import sharp from 'sharp';
import { handlePhotoDocument, handleSticker } from '../src/messageHandlers.js';

async function serveImage(t, buffer) {
	const server = createServer((request, response) => {
		response.writeHead(200, { 'content-type': 'image/webp' });
		response.end(buffer);
	});

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => server.close());
	const { port } = server.address();
	return `http://127.0.0.1:${port}/source.webp`;
}

function createContext(message, fileLink) {
	const replies = [];
	const documents = [];
	return {
		chat: { id: 991 },
		from: { id: 992 },
		message,
		replies,
		documents,
		telegram: {
			getFile: async () => ({ file_size: 1024 }),
			getFileLink: async () => fileLink,
		},
		reply: async (text) => replies.push(text),
		replyWithDocument: async (document) => {
			documents.push({
				filename: document.filename,
				buffer: Buffer.isBuffer(document.source)
					? document.source
					: await import('node:fs').then(({ readFileSync }) => readFileSync(document.source)),
			});
		},
	};
}

async function assertStickerDocument(document) {
	assert.match(document.filename, /^.+\.webp$/);
	const image = sharp(document.buffer);
	const metadata = await image.metadata();
	assert.ok(metadata.width <= 512);
	assert.ok(metadata.height <= 512);
	const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
	assert.equal(data[((info.height - 1) * info.width + Math.floor(info.width / 2)) * info.channels + 3], 0);
	assert.equal(data[((info.height - 51) * info.width + Math.floor(info.width / 2)) * info.channels + 3], 255);
}

test('an image sent before /start is returned as a buffered sticker document', async (t) => {
	const source = await sharp({
		create: { width: 1000, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
	}).webp().toBuffer();
	const context = createContext({ photo: [{ file_id: 'photo-file', file_size: source.length }] }, await serveImage(t, source));

	await handlePhotoDocument(context);

	assert.equal(context.documents.length, 1);
	assert.equal(context.replies.includes('Please select a mode first using /start.'), false);
	await assertStickerDocument(context.documents[0]);
});

test('a static sticker is returned as a buffered document within sticker dimensions', async (t) => {
	const source = await sharp({
		create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
	}).webp().toBuffer();
	const context = createContext({ sticker: { file_id: 'sticker-file', is_animated: false, is_video: false } }, await serveImage(t, source));

	await handleSticker(context);

	assert.equal(context.documents.length, 1);
	await assertStickerDocument(context.documents[0]);
});
