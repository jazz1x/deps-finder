import { describe, expect, test } from 'bun:test';
import { componentBlocks } from './component-blocks';

const bodies = (file: string, content: string) => componentBlocks(file, content).scripts.map((block) => block.text.trim());

describe('componentBlocks scripts', () => {
  test('blanks all but the block, keeping its offsets and line breaks', () => {
    const content = '<template>\n  <p/>\n</template>\n<script lang="ts">\nimport a from "a";\n</script>\n';
    const [block] = componentBlocks('A.vue', content).scripts;
    expect(block?.parsedAs).toBe('.ts');
    expect(block?.text.length).toBe(content.length);
    expect(block?.text.split('\n').length).toBe(content.split('\n').length);
    expect(block?.text.trim()).toBe('import a from "a";');
    expect(block?.text.indexOf('import')).toBe(content.indexOf('import'));
  });

  test('an attribute value holding > does not end the tag', () => {
    const content = '<script setup lang="ts" generic="T extends Record<string, any>">\nimport a from "a";\n</script>';
    expect(bodies('A.vue', content)).toEqual(['import a from "a";']);
  });

  test('takes only top-level blocks, not ones in a comment or in the template', () => {
    const content = [
      '<template>',
      '  <!-- <script>import c from "c"</script> -->',
      '  <template v-if="x"><pre>{{ `<script>import e from "e"</script>` }}</pre></template>',
      '  <script>import f from "f"</script>',
      '</template>',
      '<!-- <script setup>import d from "d"</script> -->',
      '<script setup>import a from "a";</script>',
    ].join('\n');
    expect(bodies('A.vue', content)).toEqual(['import a from "a";']);
  });

  test('a self-closing tag has no body, and a tag in its attribute value opens nothing', () => {
    const content = [
      '---',
      'import "astro";',
      '---',
      '<script is:inline src="/x.js" />',
      `<Card title="<script>import x from 'x'</script>" />`,
      '<h1>x</h1>',
      '<script>',
      'import d from "d";',
      '</script>',
    ].join('\n');
    expect(bodies('a.astro', content)).toEqual(['import "astro";', 'import d from "d";']);
  });

  test('an unclosed block runs to the end of the file, as in Vue', () => {
    expect(bodies('A.vue', '<template><div/></template>\n<script>\nimport a from "a";\n')).toEqual(['import a from "a";']);
  });

  test('a Vue custom block is opaque: a script in it is text, and a stray <template in it opens nothing', () => {
    const docs = ['<docs>', '```vue', '<script>', "import Demo from 'docs-example'", '</script>', '```', '</docs>'];
    const shown = ['<template><button/></template>', "<script>export default { name: 'Btn' }</script>", ...docs].join('\n');
    const prose = [
      '<docs>Wrap it in a `<template #header>` slot.</docs>',
      '<template><div/></template>',
      "<script>import real from 'real-dep'</script>",
    ].join('\n');
    expect(bodies('Btn.vue', shown)).toEqual(["export default { name: 'Btn' }"]);
    expect(bodies('Card.vue', prose)).toEqual(["import real from 'real-dep'"]);
  });

  test('a tag in a template interpolation or attribute value opens nothing', () => {
    const content = [
      '<template>',
      "  <pre>{{ '<script setup>' }} {{ '<template>' }}</pre>",
      `  <div v-html="'<script>'" :title="'<template>'"></div>`,
      '</template>',
      '<script setup>',
      "import a from 'pkg-a'",
      '</script>',
    ].join('\n');
    expect(bodies('Demo.vue', content)).toEqual(["import a from 'pkg-a'"]);
  });
});

describe('componentBlocks styles', () => {
  test('a <style> string in Astro frontmatter is code, not a style block', () => {
    const content = "---\nconst css = '<style>@import \"ghost\";</style>';\n---\n<style>@import 'real';</style>\n";
    expect(componentBlocks('h.astro', content).styles.map((block) => block.text.trim())).toEqual(["@import 'real';"]);
  });
});
