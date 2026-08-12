// Jest manual mock for `expo-file-system` (root-level __mocks__/, auto-applied — see
// react-native-aes-gcm-crypto.js in this same directory for the convention).
//
// Backed by Node's real `fs`, under a fresh temp directory per test process — genuine file I/O,
// not a fake in-memory stand-in — matching the real File/Directory API surface confirmed by
// reading the installed package's own generated type defs
// (src/internal/NativeFileSystem.types.ts): constructor(...uris), .exists, .create(options),
// .write(content), .bytesSync(), .textSync(), .delete(), .parentDirectory. What this proves:
// contentStore.ts's own file-handling logic (path joining, create-before-write, delete-before-
// overwrite) is correct against real disk semantics. What it does NOT prove: the real native
// module's behavior on-device — unverified in this environment, same caveat as every other
// native module mock in this directory.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-fs-mock-'));

function uriToPath(u) {
  if (u instanceof Directory || u instanceof File) return u._path();
  return u.startsWith('file://') ? u.slice('file://'.length) : u;
}

class Directory {
  constructor(...uris) {
    this.uri = 'file://' + path.join(...uris.map(uriToPath));
  }
  _path() {
    return this.uri.slice('file://'.length);
  }
  get exists() {
    return fs.existsSync(this._path());
  }
  create(options) {
    fs.mkdirSync(this._path(), { recursive: !options || options.intermediates !== false });
  }
  delete() {
    fs.rmSync(this._path(), { recursive: true, force: true });
  }
}

class File {
  constructor(...uris) {
    this.uri = 'file://' + path.join(...uris.map(uriToPath));
  }
  _path() {
    return this.uri.slice('file://'.length);
  }
  get parentDirectory() {
    return new Directory(path.dirname(this._path()));
  }
  get exists() {
    return fs.existsSync(this._path());
  }
  get size() {
    try {
      return fs.statSync(this._path()).size;
    } catch {
      return 0;
    }
  }
  create() {
    fs.writeFileSync(this._path(), Buffer.alloc(0), { flag: 'wx' });
  }
  write(content) {
    if (typeof content === 'string') {
      fs.writeFileSync(this._path(), content, 'utf8');
    } else {
      fs.writeFileSync(this._path(), Buffer.from(content));
    }
  }
  textSync() {
    return fs.readFileSync(this._path(), 'utf8');
  }
  async text() {
    return this.textSync();
  }
  bytesSync() {
    return new Uint8Array(fs.readFileSync(this._path()));
  }
  async bytes() {
    return this.bytesSync();
  }
  delete() {
    fs.unlinkSync(this._path());
  }
}

class Paths {
  static get document() {
    return new Directory(ROOT, 'document');
  }
  static get cache() {
    return new Directory(ROOT, 'cache');
  }
}

module.exports = { File, Directory, Paths };
