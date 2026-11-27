/* File categories used to colour the disk map. Shared by the page (global HD_CATS) and the scan worker (require). */
(function (root) {
  const CATS = {
    video: { label: 'Video', color: '#e9a65c', ext: 'mp4 mkv mov avi wmv webm m4v mpg mpeg ts m2ts flv 3gp vob' },
    image: { label: 'Pictures', color: '#d98fb0', ext: 'jpg jpeg png gif bmp tif tiff webp heic heif raw cr2 cr3 nef arw dng psd svg ico avif' },
    audio: { label: 'Music and audio', color: '#b79ce6', ext: 'mp3 wav flac aac m4a ogg wma opus aiff alac mid' },
    archive: { label: 'Archives', color: '#e3cf78', ext: 'zip rar 7z tar gz tgz bz2 xz zst cab lz4' },
    setup: { label: 'Installers and disk images', color: '#ee8a74', ext: 'exe msi msix msixbundle appx iso img vhd vhdx vmdk dmg wim esd' },
    game: { label: 'Games and app data', color: '#8fd0b0', ext: 'pak ucas utoc bundle vpk dll bin dat assets resource rpf arc forge big wad pck sys pdb so ckpt safetensors gguf onnx pt pth' },
    doc: { label: 'Documents', color: '#9fc3e8', ext: 'pdf doc docx xls xlsx ppt pptx txt rtf odt ods epub csv md' },
    dev: { label: 'Code and databases', color: '#b7c2cc', ext: 'js ts json py java c cpp h cs go rs db sqlite mdb log xml yml yaml lock map node' },
    other: { label: 'Other files', color: '#7d92a2', ext: '' },
  };
  const extToCat = {};
  for (const [k, v] of Object.entries(CATS)) for (const e of v.ext.split(' ')) if (e) extToCat['.' + e] = k;
  function category(name) {
    const i = name.lastIndexOf('.');
    return (i > 0 && extToCat[name.slice(i).toLowerCase()]) || 'other';
  }
  const api = { CATS, extToCat, category };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HD_CATS = api;
})(this);
