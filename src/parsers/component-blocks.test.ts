import { describe, expect, test } from 'bun:test';
import { componentScripts } from './component-blocks';

describe('componentScripts', () => {
  test('blanks all but the block, keeping its offsets and line breaks', () => {
    const content = '<template>\n  <p/>\n</template>\n<script lang="ts">\nimport a from "a";\n</script>\n';
    const [block] = componentScripts('A.vue', content);
    expect(block?.parsedAs).toBe('.ts');
    expect(block?.text.length).toBe(content.length);
    expect(block?.text.split('\n').length).toBe(content.split('\n').length);
    expect(block?.text.trim()).toBe('import a from "a";');
    expect(block?.text.indexOf('import')).toBe(content.indexOf('import'));
  });

  test('an attribute value holding > does not end the tag', () => {
    const content = '<script setup lang="ts" generic="T extends Record<string, any>">\nimport a from "a";\n</script>';
    expect(componentScripts('A.vue', content).map((block) => block.text.trim())).toEqual(['import a from "a";']);
  });
});
