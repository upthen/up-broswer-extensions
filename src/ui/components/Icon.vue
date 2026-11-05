<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number; stroke?: number }>(), { size: 15, stroke: 1.7 })

const paths: Record<string, string> = {
  braces:
    '<path d="M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  sparkles:
    '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z"/><path d="M18.5 3v3M20 4.5h-3"/>',
  folder: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h3.2l1.8 2h8A2.5 2.5 0 0 1 21 10.5v7A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  clipboard:
    '<rect x="7.5" y="3.5" width="9" height="3.5" rx="1"/><path d="M9 5.2H6.2A2.2 2.2 0 0 0 4 7.4v11.4A2.2 2.2 0 0 0 6.2 21h11.6a2.2 2.2 0 0 0 2.2-2.2V7.4a2.2 2.2 0 0 0-2.2-2.2H15"/>',
  compress: '<path d="M4 10h6V4M20 14h-6v6M10 10 3.5 16.5M14 14l6.5-6.5"/>',
  sortAsc: '<path d="M4 7h8M4 12h5M4 17h3"/><path d="M17.5 19V6m0 0-3.4 3.2M17.5 6l3.4 3.2"/>',
  sortDesc: '<path d="M4 7h8M4 12h5M4 17h3"/><path d="M17.5 5v13m0 0 3.4-3.2M17.5 18l-3.4-3.2"/>',
  quote:
    '<path d="M9.5 6.5H6.2A2.2 2.2 0 0 0 4 8.7v3.1a2.2 2.2 0 0 0 2.2 2.2h1.3v1.3A2.7 2.7 0 0 1 4.8 18"/><path d="M19.5 6.5h-3.3a2.2 2.2 0 0 0-2.2 2.2v3.1a2.2 2.2 0 0 0 2.2 2.2h1.3v1.3A2.7 2.7 0 0 1 14.8 18"/>',
  unquote:
    '<path d="M9.5 6.5H6.2A2.2 2.2 0 0 0 4 8.7v3.1a2.2 2.2 0 0 0 2.2 2.2h1.3v1.3A2.7 2.7 0 0 1 4.8 18"/><path d="M19.5 6.5h-3.3a2.2 2.2 0 0 0-2.2 2.2v3.1a2.2 2.2 0 0 0 2.2 2.2h1.3v1.3A2.7 2.7 0 0 1 14.8 18"/><path d="M3 3l18 18" stroke-width="1.4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15.5V6.2A2.2 2.2 0 0 1 7.2 4h8.3"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M4.5 17v1.8A2.2 2.2 0 0 0 6.7 21h10.6a2.2 2.2 0 0 0 2.2-2.2V17"/>',
  fold: '<path d="M4 5.5h16M4 18.5h16M9 10l3 3 3-3"/>',
  expand: '<path d="M4 9.5V5.2A1.2 1.2 0 0 1 5.2 4h4.3M14.5 4h4.3A1.2 1.2 0 0 1 20 5.2v4.3M20 14.5v4.3a1.2 1.2 0 0 1-1.2 1.2h-4.3M9.5 20H5.2A1.2 1.2 0 0 1 4 18.8v-4.3"/>',
  trash:
    '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12.2A1.6 1.6 0 0 0 9 20.7h6a1.6 1.6 0 0 0 1.6-1.5L17.5 7M10.2 11v5.5M13.8 11v5.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  sliders:
    '<path d="M4 7h8.5M17.5 7H20M4 12h3.5M12.5 12H20M4 17h9.5M18.5 17H20"/><circle cx="15" cy="7" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="16" cy="17" r="2.2"/>',
  external: '<path d="M14 4h6v6M20 4l-7.5 7.5"/><path d="M19 14v4.8A2.2 2.2 0 0 1 16.8 21H6.2A2.2 2.2 0 0 1 4 18.8V8.2A2.2 2.2 0 0 1 6.2 6H11"/>',
  alert: '<path d="M12 8.5v5M12 17h.01"/><circle cx="12" cy="12" r="8.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/>',
  swap: '<path d="M6.5 8h11l-3.2-3.2M17.5 16h-11l3.2 3.2"/>',
  file: '<path d="M13.6 3.5H7.4A2.4 2.4 0 0 0 5 5.9v12.2a2.4 2.4 0 0 0 2.4 2.4h9.2a2.4 2.4 0 0 0 2.4-2.4V8.8z"/><path d="M13.6 3.5v5.3H19"/>',
  layout: '<rect x="3.5" y="4" width="7" height="16" rx="1.6"/><rect x="13.5" y="4" width="7" height="7" rx="1.6"/><rect x="13.5" y="13" width="7" height="7" rx="1.6"/>',
  tree: '<rect x="3" y="3.5" width="6" height="4.5" rx="1.2"/><rect x="14" y="9.5" width="6" height="4.5" rx="1.2"/><rect x="14" y="16" width="6" height="4.5" rx="1.2"/><path d="M6 8v9.5h8M6 12h8"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4l-3 16"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  filter: '<path d="M3.5 5h17l-6.6 7.6V19l-3.8-2v-4.4z"/>',
  pin: '<path d="M9 3.5h6l-1 5 3.2 3.2H6.8L10 8.5z"/><path d="M12 11.7V20"/>',
  brackets: '<path d="M8 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H16"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-1.6 5.3"/><path d="M20 5v6h-6"/>',
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="paths[name] || ''"
  />
</template>
