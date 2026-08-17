/**
 * Project stack markers — shared between the main process and the renderer.
 *
 * The dashboard badges a project with its stack, and the bulk-import scanner
 * badges every scan result the same way. Both need identical answers, so the
 * table and the matching rules live here.
 *
 * Data and pure matching only: each side does its own file reading, so this
 * module stays dependency-free and usable from either process.
 */

const PROJECT_TYPE_MARKERS = [
  // Order matters: more specific first
  { type: 'fivem',      label: 'FiveM',      color: '#F97316', files: ['fxmanifest.lua', '__resource.lua'] },
  { type: 'next',       label: 'Next.js',    color: '#000000', deps: ['next'] },
  { type: 'nuxt',       label: 'Nuxt',       color: '#00DC82', deps: ['nuxt'] },
  { type: 'svelte',     label: 'Svelte',     color: '#FF3E00', deps: ['svelte'] },
  { type: 'angular',    label: 'Angular',    color: '#DD0031', files: ['angular.json'] },
  { type: 'react',      label: 'React',      color: '#61DAFB', deps: ['react'] },
  { type: 'vue',        label: 'Vue',        color: '#42B883', deps: ['vue'] },
  { type: 'electron',   label: 'Electron',   color: '#9FEAF9', deps: ['electron'] },
  { type: 'express',    label: 'Express',    color: '#68A063', deps: ['express'] },
  { type: 'nestjs',     label: 'NestJS',     color: '#E0234E', deps: ['@nestjs/core'] },
  { type: 'typescript', label: 'TypeScript', color: '#3178C6', files: ['tsconfig.json'] },
  { type: 'node',       label: 'Node.js',    color: '#68A063', files: ['package.json'] },
  { type: 'rust',       label: 'Rust',       color: '#DEA584', files: ['Cargo.toml'] },
  { type: 'go',         label: 'Go',         color: '#00ADD8', files: ['go.mod'] },
  { type: 'python',     label: 'Python',     color: '#3776AB', files: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'] },
  { type: 'ruby',       label: 'Ruby',       color: '#CC342D', files: ['Gemfile'] },
  { type: 'java',       label: 'Java',       color: '#ED8B00', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { type: 'csharp',     label: 'C#',         color: '#512BD4', files: ['*.sln', '*.csproj'] },
  { type: 'php',        label: 'PHP',        color: '#777BB4', files: ['composer.json'] },
  { type: 'dart',       label: 'Flutter',    color: '#02569B', files: ['pubspec.yaml'] },
  { type: 'cpp',        label: 'C/C++',      color: '#00599C', files: ['CMakeLists.txt', 'Makefile'] },
  { type: 'lua',        label: 'Lua',        color: '#000080', files: ['*.lua'] },
];

/**
 * Match a directory against the marker table.
 * Pure — the caller supplies the already-read directory listing and, when a
 * package.json exists, its dependency names.
 *
 * @param {string[]} entries Directory listing (names only, not paths)
 * @param {Set<string>} [deps] Names from package.json dependencies + devDependencies
 * @returns {{ type: string, label: string, color: string }|null}
 */
function matchMarkers(entries, deps) {
  const names = new Set(entries);
  const depSet = deps || new Set();

  for (const marker of PROJECT_TYPE_MARKERS) {
    if (marker.files) {
      const hasFile = marker.files.some(f => {
        if (f.startsWith('*.')) {
          const ext = f.slice(1); // e.g. '.lua'
          return entries.some(e => e.endsWith(ext));
        }
        return names.has(f);
      });
      if (hasFile) {
        if (!marker.deps) return { type: marker.type, label: marker.label, color: marker.color };
      } else if (!marker.deps) {
        continue;
      }
    }

    if (marker.deps) {
      if (depSet.size === 0) continue;
      if (marker.deps.some(dep => depSet.has(dep))) {
        return { type: marker.type, label: marker.label, color: marker.color };
      }
    }
  }

  return null;
}

module.exports = { PROJECT_TYPE_MARKERS, matchMarkers };
