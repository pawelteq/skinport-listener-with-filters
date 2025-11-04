// Lightweight msgpack parser wrapper for socket.io-client
// Uses msgpack-lite to encode/decode and exposes the simple API expected by
// socket.io's parser option: encode(packet) => [encoded], decode(data) => packet

const msgpack = require('msgpack-lite');
const EventEmitter = require('events');

// Encoder/Decoder classes compatible with socket.io's parser interface
class Encoder {
  encode(packet) {
    try {
      const encoded = msgpack.encode(packet);
      return [encoded];
    } catch (err) {
      return [Buffer.from(JSON.stringify(packet))];
    }
  }
}

class Decoder extends EventEmitter {
  add(obj) {
    try {
      if (Buffer.isBuffer(obj)) {
        const decoded = msgpack.decode(obj);
        this.emit('decoded', decoded);
        return;
      }
      if (typeof obj === 'string') {
        this.emit('decoded', JSON.parse(obj));
        return;
      }
      // Fallback for ArrayBuffer/Uint8Array
      this.emit('decoded', msgpack.decode(Buffer.from(obj)));
    } catch (err) {
      try { this.emit('decoded', JSON.parse(obj.toString())); } catch (e) { this.emit('decoded', obj); }
    }
  }

  destroy() {
    // no-op; provided for API completeness
  }
}

module.exports = { Encoder, Decoder };
