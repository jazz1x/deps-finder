import { describe, expect, test } from 'bun:test';
import { Result } from 'effect';
import { FileError } from '@/domain/errors';
import { type StyleSyntax, stylesheetReferences } from './stylesheet-parser';

const specifiers = (syntax: StyleSyntax, content: string) =>
  Result.getOrThrow(stylesheetReferences('a.css', content, syntax)).map(({ line, specifier }) => `${line}:${specifier}`);

describe('stylesheetReferences', () => {
  test('reads what CSS at-rules load, dropping ~, URLs, data: and url() in declarations', () => {
    const css = [
      "@import 'slick-carousel/slick/slick.css';",
      '@import url("~mapbox-gl/dist/mapbox-gl.css") screen, print;',
      '@import "tailwindcss" source(none);',
      '@plugin "@tailwindcss/typography";',
      '@config "./tailwind.config.js";',
      '@reference "../app.css";',
      '@import url(https://fonts.googleapis.com/css?family=Inter);',
      "@import 'data:text/css,a{}';",
      '@media print { @import "/abs.css"; }',
      '.a { background: url(~leaflet/dist/images/marker.png); }',
    ].join('\n');
    expect(specifiers('css', css)).toEqual([
      '1:slick-carousel/slick/slick.css',
      '2:mapbox-gl/dist/mapbox-gl.css',
      '3:tailwindcss',
      '4:@tailwindcss/typography',
      '5:./tailwind.config.js',
      '6:../app.css',
      '9:/abs.css',
    ]);
  });

  test('reads Sass @use, @forward and a list @import, skipping sass: modules', () => {
    const scss = [
      '// @import "commented";',
      '@use "sass:math";',
      '@use "bulma/sass" as b;',
      '@import "normalize.css", "~bootstrap/scss/bootstrap";',
      '@forward "pkg" show x;',
    ].join('\n');
    expect(specifiers('scss', scss)).toEqual(['3:bulma/sass', '4:normalize.css', '4:bootstrap/scss/bootstrap', '5:pkg']);
  });

  test('reads a Less @import with options and @plugin', () => {
    const less = ['@import (reference) "~ant-design-vue/lib/style/index.less";', '@plugin "less-plugin-x";', '@gap: 4px;'].join('\n');
    expect(specifiers('less', less)).toEqual(['1:ant-design-vue/lib/style/index.less', '2:less-plugin-x']);
  });

  test('a stylesheet that does not parse fails with the reason', () => {
    const result = stylesheetReferences('a.css', '.a { color: red', 'css');
    expect(Result.isFailure(result)).toBe(true);
    Result.match(result, {
      onSuccess: () => expect.unreachable(),
      onFailure: (error) => {
        expect(FileError.$is('ParseFailed')(error)).toBe(true);
        expect(error.path).toBe('a.css');
      },
    });
  });
});
