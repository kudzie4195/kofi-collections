declare module 'virtual:bundled-art' {
  /** public/art file name → URL (served path, or a data URL in the single-file build). */
  const art: Record<string, string>;
  export default art;
}
