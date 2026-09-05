import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFERENCE_ORIGIN_PRIORITY,
  canPreferenceSuggestionApply,
  canPreferenceSuggestionReplace,
  markPreferenceOrigin,
  preferenceOrigin
} from '../public/ui-preference-origin.js';

test('saved explicit and domain origins outrank adaptive suggestions', () => {
  assert.ok(PREFERENCE_ORIGIN_PRIORITY.saved > PREFERENCE_ORIGIN_PRIORITY.suggested);
  assert.ok(PREFERENCE_ORIGIN_PRIORITY.explicit > PREFERENCE_ORIGIN_PRIORITY.suggested);
  assert.ok(PREFERENCE_ORIGIN_PRIORITY.domain > PREFERENCE_ORIGIN_PRIORITY.suggested);
  assert.equal(canPreferenceSuggestionReplace('saved'), false);
  assert.equal(canPreferenceSuggestionReplace('explicit'), false);
  assert.equal(canPreferenceSuggestionReplace('domain'), false);
  assert.equal(canPreferenceSuggestionReplace('suggested'), true);
  assert.equal(canPreferenceSuggestionReplace('static'), true);
});

test('marking a protected value reuses the existing dirty contract', () => {
  const element = { disabled: false, dataset: {} };
  assert.equal(preferenceOrigin(element), 'static');
  assert.equal(canPreferenceSuggestionApply(element), true);

  markPreferenceOrigin(element, 'saved');
  assert.equal(preferenceOrigin(element), 'saved');
  assert.equal(element.dataset.uiPreferenceDirty, '1');
  assert.equal(canPreferenceSuggestionApply(element), false);

  markPreferenceOrigin(element, 'domain');
  assert.equal(preferenceOrigin(element), 'domain');
  assert.equal(canPreferenceSuggestionApply(element), false);

  markPreferenceOrigin(element, 'suggested');
  assert.equal(preferenceOrigin(element), 'suggested');
  assert.equal('uiPreferenceDirty' in element.dataset, false);
  assert.equal(canPreferenceSuggestionApply(element), true);

  markPreferenceOrigin(element, 'explicit');
  assert.equal(preferenceOrigin(element), 'explicit');
  assert.equal(canPreferenceSuggestionApply(element), false);
});
