import { StringDecoder } from 'node:string_decoder';

const MAX_PENDING_EVENT_BYTES = 8 * 1024 * 1024;

/** Incrementally extracts Mirakurun event objects from its JSON stream. */
export default class JsonEventParser {
    private readonly decoder = new StringDecoder('utf8');
    private pendingParts: string[] = [];
    private pendingBytes = 0;
    private depth = 0;
    private inString = false;
    private escaped = false;
    private finished = false;

    /** Add a stream chunk and return every complete JSON object in it. */
    public push(chunk: Buffer | string): unknown[] {
        if (this.finished) throw new Error('Mirakurun event parser is already finished');
        const decoded = this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
        return this.consume(decoded);
    }

    /** Flush the UTF-8 decoder and reject an unfinished JSON object. */
    public finish(): void {
        if (this.finished) return;
        this.finished = true;
        this.consume(this.decoder.end());
        if (this.depth !== 0) throw new Error('Incomplete Mirakurun event JSON object');
    }

    private consume(chunk: string): unknown[] {
        const values: unknown[] = [];
        let frameStart = this.depth === 0 ? -1 : 0;

        for (let index = 0; index < chunk.length; index++) {
            const character = chunk[index];
            if (this.depth === 0) {
                if (character === '{') {
                    this.depth = 1;
                    this.inString = false;
                    this.escaped = false;
                    frameStart = index;
                    continue;
                }
                if (/\s/u.test(character) || character === '[' || character === ']' || character === ',') continue;
                throw new Error('Unexpected data in Mirakurun event stream');
            }

            if (this.inString) {
                if (this.escaped) this.escaped = false;
                else if (character === '\\') this.escaped = true;
                else if (character === '"') this.inString = false;
                continue;
            }

            if (character === '"') this.inString = true;
            else if (character === '{') this.depth++;
            else if (character === '}') this.depth--;

            if (this.depth === 0) {
                const currentPart = chunk.slice(frameStart, index + 1);
                const byteLength = this.pendingBytes + Buffer.byteLength(currentPart, 'utf8');
                if (byteLength > MAX_PENDING_EVENT_BYTES) {
                    throw new Error('Mirakurun event JSON object exceeds 8 MiB');
                }

                const frame = this.pendingParts.length === 0 ? currentPart : this.pendingParts.join('') + currentPart;
                try {
                    values.push(JSON.parse(frame));
                } catch {
                    throw new Error('Invalid Mirakurun event JSON object');
                }
                this.pendingParts = [];
                this.pendingBytes = 0;
                this.inString = false;
                this.escaped = false;
                frameStart = -1;
            }
        }

        if (this.depth !== 0) {
            const currentPart = chunk.slice(frameStart === -1 ? 0 : frameStart);
            if (currentPart.length > 0) {
                this.pendingBytes += Buffer.byteLength(currentPart, 'utf8');
                if (this.pendingBytes > MAX_PENDING_EVENT_BYTES) {
                    throw new Error('Mirakurun event JSON object exceeds 8 MiB');
                }
                this.pendingParts.push(currentPart);
            }
        }

        return values;
    }
}
