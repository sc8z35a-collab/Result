// Each stored unit is one hundredth of a credit. The award receipt and the
// balance share a transaction, so replays and simultaneous tabs cannot double-pay.
const blank = () => ({ units: 0, evr: false });
export const money = units => (units / 100).toFixed(2);

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('account');
      request.result.createObjectStore('awards');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class PilotWallet {
  constructor(changed, profile = 'result-pilot') {
    this.changed = changed;
    this.profile = profile;
    this.state = blank();
    this.receipts = new Set();
    this.db = null;
    this.channel = null;
    this.ready = this.open();
  }

  async open() {
    try {
      this.db = await openDatabase(this.profile);
    } catch {
      this.readBackup();
    }
    if (typeof window !== 'undefined' && typeof BroadcastChannel === 'function') {
      this.channel = new BroadcastChannel(this.profile + '-wallet');
      this.channel.onmessage = () => this.read().catch(() => {});
    }
    await this.read();
  }

  readBackup() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.profile + '-fallback'));
      if (saved && Number.isSafeInteger(saved.units)) {
        this.state = { units: saved.units, evr: !!saved.evr };
        this.receipts = new Set(saved.receipts || []);
      }
    } catch {}
  }

  async read() {
    if (this.db) {
      this.state = await new Promise((resolve, reject) => {
        const request = this.db.transaction('account').objectStore('account').get('pilot');
        request.onsuccess = () => resolve(request.result || blank());
        request.onerror = () => reject(request.error);
      });
    } else {
      this.readBackup();
    }
    this.changed(this.state);
    return this.state;
  }

  changeBackup(receipt) {
    this.readBackup();
    if (receipt ? this.receipts.has(receipt) : this.state.evr || this.state.units < 5) return false;
    if (receipt) this.receipts.add(receipt);
    this.state = { units: this.state.units + (receipt ? 10 : -5), evr: this.state.evr || !receipt };
    try {
      localStorage.setItem(this.profile + '-fallback', JSON.stringify({ ...this.state, receipts: [...this.receipts] }));
    } catch {}
    return true;
  }

  async change(receipt = null) {
    await this.ready;
    let changed;
    if (this.db) {
      changed = await this.commit(receipt);
    } else if (globalThis.navigator?.locks) {
      changed = await navigator.locks.request(this.profile + '-update', () => this.changeBackup(receipt));
    } else {
      changed = this.changeBackup(receipt);
    }
    this.changed(this.state);
    if (changed) this.channel?.postMessage('updated');
    return changed;
  }

  commit(receipt) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['account', 'awards'], 'readwrite');
      const accounts = tx.objectStore('account');
      const awards = tx.objectStore('awards');
      let changed = false;
      let after;
      const request = accounts.get('pilot');
      request.onsuccess = () => {
        after = request.result || blank();
        if (receipt) {
          const previous = awards.getKey(receipt);
          previous.onsuccess = () => {
            if (previous.result !== undefined) return;
            awards.put(1, receipt);
            after = { ...after, units: after.units + 10 };
            accounts.put(after, 'pilot');
            changed = true;
          };
        } else if (!after.evr && after.units >= 5) {
          after = { units: after.units - 5, evr: true };
          accounts.put(after, 'pilot');
          changed = true;
        }
      };
      tx.oncomplete = () => {
        this.state = after;
        resolve(changed);
      };
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
}
