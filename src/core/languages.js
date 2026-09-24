// Language detection by file name / extension. Colors follow GitHub Linguist
// where a language has one, so galaxies feel familiar to GitHub users.

export const LANGUAGES = {
  JavaScript: { color: '#f1e05a', ext: ['js', 'mjs', 'cjs', 'jsx'] },
  TypeScript: { color: '#3178c6', ext: ['ts', 'tsx', 'mts', 'cts'] },
  Python: { color: '#3572A5', ext: ['py', 'pyi', 'pyx', 'ipynb'] },
  Go: { color: '#00ADD8', ext: ['go'] },
  Rust: { color: '#dea584', ext: ['rs'] },
  Java: { color: '#b07219', ext: ['java'] },
  Kotlin: { color: '#A97BFF', ext: ['kt', 'kts'] },
  Swift: { color: '#F05138', ext: ['swift'] },
  C: { color: '#555555', ext: ['c', 'h'] },
  'C++': { color: '#f34b7d', ext: ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'ino'] },
  'C#': { color: '#178600', ext: ['cs', 'csx'] },
  Ruby: { color: '#701516', ext: ['rb', 'erb', 'gemspec', 'rake'] },
  PHP: { color: '#4F5D95', ext: ['php', 'phtml'] },
  Dart: { color: '#00B4AB', ext: ['dart'] },
  Scala: { color: '#c22d40', ext: ['scala', 'sc'] },
  Elixir: { color: '#6e4a7e', ext: ['ex', 'exs'] },
  Erlang: { color: '#B83998', ext: ['erl', 'hrl'] },
  Haskell: { color: '#5e5086', ext: ['hs', 'lhs'] },
  Lua: { color: '#000080', ext: ['lua'] },
  Zig: { color: '#ec915c', ext: ['zig'] },
  Nim: { color: '#ffc200', ext: ['nim'] },
  OCaml: { color: '#ef7a08', ext: ['ml', 'mli'] },
  Clojure: { color: '#db5855', ext: ['clj', 'cljs', 'cljc', 'edn'] },
  R: { color: '#198CE7', ext: ['r', 'rmd'] },
  Julia: { color: '#a270ba', ext: ['jl'] },
  Shell: { color: '#89e051', ext: ['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'] },
  HTML: { color: '#e34c26', ext: ['html', 'htm', 'xhtml'] },
  CSS: { color: '#663399', ext: ['css', 'scss', 'sass', 'less', 'styl'] },
  Vue: { color: '#41b883', ext: ['vue'] },
  Svelte: { color: '#ff3e00', ext: ['svelte'] },
  Astro: { color: '#ff5a03', ext: ['astro'] },
  SQL: { color: '#e38c00', ext: ['sql', 'prisma'] },
  GraphQL: { color: '#e10098', ext: ['graphql', 'gql'] },
  Markdown: { color: '#8fa7c9', ext: ['md', 'mdx', 'markdown', 'rst', 'txt', 'adoc'] },
  JSON: { color: '#9aa5b1', ext: ['json', 'jsonc', 'json5'] },
  YAML: { color: '#cb171e', ext: ['yml', 'yaml'] },
  TOML: { color: '#9c4221', ext: ['toml', 'ini', 'cfg', 'conf', 'env'] },
  XML: { color: '#0060ac', ext: ['xml', 'xsd', 'plist', 'csproj'] },
  Image: { color: '#b4f0ff', ext: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif'] },
  Media: { color: '#ffd6f5', ext: ['mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'ttf', 'otf', 'woff', 'woff2'] },
  Build: { color: '#d6d6a8', ext: ['lock', 'mk', 'cmake', 'gradle', 'bazel', 'bzl', 'nix'] },
};

// Whole-file-name matches take precedence over extensions.
const FILENAMES = {
  dockerfile: 'Build',
  makefile: 'Build',
  'cmakelists.txt': 'Build',
  'package.json': 'Build',
  'cargo.toml': 'Build',
  'go.mod': 'Build',
  'go.sum': 'Build',
  gemfile: 'Ruby',
  rakefile: 'Ruby',
  license: 'Markdown',
  readme: 'Markdown',
  '.gitignore': 'Build',
  '.gitattributes': 'Build',
};

export const OTHER = { name: 'Other', color: '#c8ccd4' };

const EXT_INDEX = new Map();
for (const [name, lang] of Object.entries(LANGUAGES)) {
  for (const ext of lang.ext) EXT_INDEX.set(ext, name);
}

/** Returns the language name for a path ("Other" when unknown). */
export function detectLanguage(path) {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (FILENAMES[base]) return FILENAMES[base];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return OTHER.name;
  return EXT_INDEX.get(base.slice(dot + 1)) ?? OTHER.name;
}

export function languageColor(name) {
  return LANGUAGES[name]?.color ?? OTHER.color;
}
