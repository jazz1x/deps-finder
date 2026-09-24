import { describe, expect, test } from 'bun:test';
import { componentScripts } from './component-blocks';

const bodies = (file: string, content: string) => componentScripts(file, content).map((block) => block.text.trim());

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

  test('takes only top-level blocks, not ones in a comment or in the template', () => {
    const content = [
      '<template>',
      '  <!-- <script>import c from "c"</script> -->',
      '  <template v-if="x"><pre>{{ `<script>import e from "e"</script>` }}</pre></template>',
      '</template>',
      '<!-- <script setup>import d from "d"</script> -->',
      '<script setup>import a from "a";</script>',
    ].join('\n');
    expect(bodies('A.vue', content)).toEqual(['import a from "a";']);
  });

  test('a self-closing script tag has no body and does not swallow the next block', () => {
    const content = '---\nimport "astro";\n---\n<script is:inline src="/x.js" />\n<h1>x</h1>\n<script>\nimport d from "d";\n</script>\n';
    expect(bodies('a.astro', content)).toEqual(['import "astro";', 'import d from "d";']);
  });
});
