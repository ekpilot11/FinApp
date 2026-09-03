import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dictationCaveat } from '../js/speech.js';

// Real user-agent strings, because the whole point of this check is that it
// runs against whatever the browser actually sends.
const AGENTS = {
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  firefoxIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  edgeIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/126.0.2592.87 Mobile/15E148 Safari/604.1',
  chromeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
};

describe('dictationCaveat', () => {
  it('says nothing in Safari on an iPhone, where dictation works', () => {
    assert.equal(dictationCaveat(AGENTS.safariIOS), null);
  });

  it('warns in Chrome on an iPhone, where the API is exposed but dead', () => {
    const caveat = dictationCaveat(AGENTS.chromeIOS);
    assert.match(caveat, /Chrome/);
    assert.match(caveat, /Safari/);
  });

  it('names the browser you are actually in', () => {
    assert.match(dictationCaveat(AGENTS.firefoxIOS), /Firefox/);
    assert.match(dictationCaveat(AGENTS.edgeIOS), /Edge/);
  });

  it('points at what still works rather than just refusing', () => {
    const caveat = dictationCaveat(AGENTS.chromeIOS);
    assert.match(caveat, /type/i);
    assert.match(caveat, /screenshot/i);
  });

  it('leaves desktop Chrome alone, where dictation is real', () => {
    // "Safari/537.36" appears in this string; matching on that would be wrong.
    assert.equal(dictationCaveat(AGENTS.chromeDesktop), null);
  });

  it('leaves Chrome on Android alone — it has the best support of any browser', () => {
    assert.equal(dictationCaveat(AGENTS.chromeAndroid), null);
  });

  it('says nothing when there is no user agent to read', () => {
    assert.equal(dictationCaveat(''), null);
    assert.equal(dictationCaveat(undefined), null);
  });
});
