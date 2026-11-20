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
    this.pendingPrefix = this.backupKey + '/pending/';
    this.confirmedKey = profile + '-confirmed';
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
      if (e.key === null || e.key === this.backupKey || e.key === this.unlockKey || e.key.startsWith(this.awardPrefix)) {
        this.ready.then(() => this.read()).catch(() => {});
      }
    });
    try {
      await this.read();
    } catch {
      this.state = this.backupAccount(this.readBackup());
      this.changed(this.state);
    }
  }

  async connect() {
    const db = await openDatabase(this.profile);
    this.imported = null;
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

  stageAward(receipt) {
    if (!validReceipt(receipt)) return;
    try { localStorage.setItem(this.pendingPrefix + receipt, '1'); } catch {}
  }

  stagedAwards() {
    const receipts = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.pendingPrefix)) {
          const receipt = key.slice(this.pendingPrefix.length);
          if (validReceipt(receipt)) receipts.push(receipt);
        }
      }
    } catch {}
    return receipts;
  }

  readConfirmed() {
    let confirmed;
    try { confirmed = JSON.parse(localStorage.getItem(this.confirmedKey)); } catch {}
    return validUnits(confirmed?.units) && Array.isArray(confirmed.receipts) ? confirmed : null;
  }

  backupAccount(saved, confirmed = this.readConfirmed()) {
    if (!confirmed) return account(saved);
    const imported = new Set(confirmed.receipts);
    let units = confirmed.units;
    for (const receipt of saved.receipts) {
      if (!imported.has(receipt)) units += 10;
    }
    if (saved.evr && !confirmed.evr) units -= 5;
    return {units: validUnits(units) ? units : 0, evr: confirmed.evr === true || saved.evr};
  }

  rememberConfirmed(receipt = null) {
    const previous = this.readConfirmed();
    const receipts = new Set(previous?.receipts || []);
    for (const imported of this.imported?.receipts || []) receipts.add(imported);
    if (receipt !== null) receipts.add(receipt);
    // Confirmations can complete out of order. Gross credits only increase
    // and an already applied unlock is retained at the same gross amount.
    const gross = a => a.units + (a.evr ? 5 : 0);
    const latest = previous && (gross(previous) > gross(this.state) ||
      (gross(previous) === gross(this.state) && previous.evr)) ? account(previous) : this.state;
    try {
      localStorage.setItem(this.confirmedKey, JSON.stringify({...latest, receipts: [...receipts]}));
    } catch {}
  }

  async read() {
    if (this.db) {
      await this.importBackup();
      this.state = await this.transaction('readonly', () => {});
      this.rememberConfirmed();
    } else {
      this.state = this.backupAccount(this.readBackup());
    }
    this.changed(this.state);
    return this.state;
  }

  changeBackup(receipt) {
    const saved = this.readBackup();
    const confirmed = this.readConfirmed();
    const before = this.backupAccount(saved, confirmed);
    if (receipt ? saved.receipts.has(receipt) || confirmed?.receipts.includes(receipt) : before.evr || before.units < 5) {
      this.state = before;
      return false;
    }
    const units = before.units + (receipt ? 10 : -5);
    if (!validUnits(units)) throw new RangeError('Invalid wallet balance');
    // Separate keys prevent different awards from overwriting each other.
    localStorage.setItem(receipt ? this.awardPrefix + receipt : this.unlockKey, '1');
    this.state = this.backupAccount(this.readBackup());
    return true;
  }

  async withBackupLock(action) {
    const locks = globalThis.navigator?.locks;
    if (!locks) return action();
    let result;
    try {
      result = await locks.request(this.profile + '-update', {ifAvailable: true}, async () => {
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
    const saved = this.readBackup();
    const imported = this.imported;
    if (imported && imported.units === saved.units && imported.evr === saved.evr &&
        imported.receipts.size === saved.receipts.size && [...saved.receipts].every(receipt => imported.receipts.has(receipt))) return;
    if (saved.receipts.size || saved.evr || saved.units) {
      // The transaction deduplicates receipts even while another tab imports
      // its own snapshot of the fallback account.
      await this.transaction('readwrite', (before, awards, store) => {
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
    }
    this.imported = saved;
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
      try {
        await this.importBackup();
        changed = await this.commit(receipt);
        this.rememberConfirmed(receipt);
      } catch (error) {
        // Each award is additive and reconciled by receipt. Purchases must
        // wait for the IndexedDB transaction if the active database fails.
        if (receipt === null) throw error;
        changed = await this.withBackupLock(() => this.changeBackup(receipt));
      }
    } else {
      changed = await this.withBackupLock(() => this.changeBackup(receipt));
    }
    if (receipt !== null) {
      try { localStorage.removeItem(this.pendingPrefix + receipt); } catch {}
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
