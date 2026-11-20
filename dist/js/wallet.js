// Each unit is one hundredth of a credit. IndexedDB commits a balance change
// and the matching receipt together, including concurrent writes from other tabs.
const blank = () => ({units: 0, evr: false});
const validUnits = value => Number.isSafeInteger(value) && value >= 0;
const validReceipt = value => typeof value === 'string' && value.length > 0;
const account = value => ({
  units: validUnits(value?.units) ? value.units : 0,
  evr: value?.evr === true
});
export const money = units => (units / 100).toFixed(2);

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let abandoned = false;
    const stopWaiting = () => {
      if (abandoned) return;
      clearTimeout(timeout);
      abandoned = true;
      reject(new Error('Wallet database is blocked'));
    };
    const timeout = setTimeout(stopWaiting, 1500);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('account');
      request.result.createObjectStore('awards');
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error);
    };
    request.onblocked = stopWaiting;
  });
}

export class PilotWallet {
  constructor(changed = () => {}, profile = 'result-pilot') {
    this.changed = changed;
    this.profile = profile;
    this.backupKey = profile + '-fallback';
    this.awardPrefix = this.backupKey + '/award/';
    this.unlockKey = this.backupKey + '/evr';
    this.state = blank();
    this.db = null;
    this.channel = null;
    this.ready = this.open();
  }

  async open() {
    try {
      await this.connect();
    } catch {
      // A profile with unavailable IndexedDB can persist locally and migrate later.
      if (this.db) this.db.close();
      this.db = null;
    }
    try {
      if (typeof window !== 'undefined' && typeof BroadcastChannel === 'function') {
        this.channel = new BroadcastChannel(this.profile + '-wallet');
        this.channel.onmessage = () => this.ready.then(() => this.read()).catch(() => {});
      }
    } catch {}
    globalThis.window?.addEventListener?.('storage', e => {
      if (e.key === null || e.key === this.backupKey || e.key.startsWith(this.backupKey + '/')) {
        this.ready.then(async () => {
          if (this.db) await this.importBackup();
          await this.read();
        }).catch(() => {});
      }
    });
    try {
      await this.read();
    } catch {
      this.state = account(this.readBackup());
      this.changed(this.state);
    }
  }

  async connect() {
    const db = await openDatabase(this.profile);
    this.db = db;
    db.onversionchange = db.onclose = () => {
      db.close();
      if (this.db === db) this.db = null;
    };
    await this.importBackup();
  }

  readBackup() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(this.backupKey)); } catch {}
    const legacy = account(saved);
    const receipts = new Set(Array.isArray(saved?.receipts) ? saved.receipts.filter(validReceipt) : []);
    const oldCount = receipts.size;
    let unlocked = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.awardPrefix)) receipts.add(key.slice(this.awardPrefix.length));
      }
      unlocked = localStorage.getItem(this.unlockKey) === '1';
    } catch {}
    const units = legacy.units + (receipts.size - oldCount) * 10 - (unlocked && !legacy.evr ? 5 : 0);
    return {units: validUnits(units) ? units : 0, evr: legacy.evr || unlocked, receipts};
  }

  async read() {
    if (this.db) {
      this.state = await this.transaction('readonly', () => false);
    } else {
      this.state = account(this.readBackup());
    }
    this.changed(this.state);
    return this.state;
  }

  changeBackup(receipt) {
    const {receipts, ...before} = this.readBackup();
    if (receipt ? receipts.has(receipt) : before.evr || before.units < 5) {
      this.state = before;
      return false;
    }
    const units = before.units + (receipt ? 10 : -5);
    if (!validUnits(units)) throw new RangeError('Invalid wallet balance');
    // Separate keys prevent two independent awards from overwriting each other
    // even in browsers that lack the Web Locks API.
    localStorage.setItem(receipt ? this.awardPrefix + receipt : this.unlockKey, '1');
    this.state = account(this.readBackup());
    return true;
  }

  async withBackupLock(action) {
    const locks = globalThis.navigator?.locks;
    if (!locks) return action();
    let result;
    try {
      result = await locks.request(this.profile + '-update', async () => {
        try { return {value: await action()}; } catch (error) { return {error}; }
      });
    } catch (error) {
      if (error?.name === 'SecurityError') return action();
      throw error;
    }
    if (Object.hasOwn(result, 'error')) throw result.error;
    return result.value;
  }

  async importBackup() {
    await this.withBackupLock(async () => {
      const saved = this.readBackup();
      if (!saved.receipts.size && !saved.evr && !saved.units) return;
      // A second tab can repeat the import. Each existing fallback receipt and
      // the EVR1 unlock are checked again in the IndexedDB transaction.
      this.state = await this.transaction('readwrite', (before, awards, store) => {
        let added = 0, remaining = saved.receipts.size;
        const legacyExtra = Math.max(0, saved.units + (saved.evr ? 5 : 0) - remaining * 10);
        const legacyMarker = [this.backupKey, 'legacy-balance'];
        const finish = () => {
          const legacy = legacyExtra ? awards.getKey(legacyMarker) : null;
          const settle = extra => {
            const units = before.units + added * 10 + extra;
            const evr = before.evr || (saved.evr && units >= 5);
            if (!validUnits(units)) { awards.transaction.abort(); return; }
            store({units: units - (evr && !before.evr ? 5 : 0), evr});
          };
          if (!legacy) settle(0);
          else legacy.onsuccess = () => {
            const extra = legacy.result === undefined ? legacyExtra : 0;
            if (extra) awards.add(1, legacyMarker);
            settle(extra);
          };
        };
        if (!remaining) finish();
        for (const receipt of saved.receipts) {
          const lookup = awards.getKey(receipt);
          lookup.onsuccess = () => {
            if (lookup.result === undefined) {
              awards.add(1, receipt);
              added++;
            }
            if (--remaining === 0) finish();
          };
        }
      });
    });
  }

  async change(receipt = null) {
    if (receipt !== null && !validReceipt(receipt)) throw new TypeError('Invalid award receipt');
    await this.ready;
    // Reopen after an IndexedDB version change or a temporary open failure.
    if (!this.db) {
      this.reconnect ??= this.connect().catch(() => {
        this.db?.close();
        this.db = null;
      }).finally(() => { this.reconnect = null; });
      await this.reconnect;
    }
    let changed;
    if (this.db) {
      changed = await this.commit(receipt);
    } else {
      changed = await this.withBackupLock(() => this.changeBackup(receipt));
    }
    this.changed(this.state);
    if (changed) {
      try { this.channel?.postMessage('updated'); } catch {}
    }
    return changed;
  }

  async commit(receipt) {
    let changed = false;
    this.state = await this.transaction('readwrite', (before, awards, store) => {
      if (receipt !== null) {
        const previous = awards.getKey(receipt);
        previous.onsuccess = () => {
          if (previous.result !== undefined) return;
          const units = before.units + 10;
          if (!validUnits(units)) {
            awards.transaction.abort();
            return;
          }
          awards.add(1, receipt);
          store({...before, units});
          changed = true;
        };
      } else if (!before.evr && before.units >= 5) {
        store({units: before.units - 5, evr: true});
        changed = true;
      }
    });
    return changed;
  }

  transaction(mode, update) {
    return new Promise((resolve, reject) => {
      const writable = mode === 'readwrite';
      const tx = this.db.transaction(writable ? ['account', 'awards'] : 'account', mode);
      const accounts = tx.objectStore('account');
      const awards = writable ? tx.objectStore('awards') : null;
      let after;
      const request = accounts.get('pilot');
      request.onsuccess = () => {
        after = account(request.result);
        try {
          update(after, awards, state => {
            accounts.put(state, 'pilot');
            after = state;
          });
        } catch {
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(after);
      tx.onabort = () => reject(tx.error || new Error('Wallet transaction aborted'));
    });
  }
}
