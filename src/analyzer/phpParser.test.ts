import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PhpParser } from './phpParser.js';

describe('PhpParser method calls', () => {
  it('collects every static and instance call on consecutive lines', () => {
    const parser = new PhpParser();
    const code = [
      '<?php',
      'VeryLongService::firstCall(); $this->secondCall();',
      'A::b();',
      '// Ignored::comment();',
      '$this->thirdCall();',
    ].join('\n');
    const expected = [
      { name: 'firstCall', line: 2 },
      { name: 'secondCall', line: 2 },
      { name: 'b', line: 3 },
      { name: 'thirdCall', line: 5 },
    ];
    assert.deepStrictEqual(parser.parseFile('sample.php', code).calls, expected);
    assert.deepStrictEqual(parser.parseFile('sample.php', code).calls, expected);
  });
});
