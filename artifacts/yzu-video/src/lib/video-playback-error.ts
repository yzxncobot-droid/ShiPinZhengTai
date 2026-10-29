export function describeVideoPlaybackError(code?: number): string {
  switch (code) {
    case 1:
      return "Pemutaran dihentikan sebelum video selesai dimuat. Coba putar kembali.";
    case 2:
      return "Koneksi ke server streaming terputus. Periksa koneksi lalu coba lagi.";
    case 3:
      return "Data video tidak dapat didekode. File mungkin rusak atau memakai codec yang tidak didukung browser.";
    case 4:
      return "Browser tidak dapat memutar sumber video ini. Format atau codec mungkin tidak didukung, atau respons server bukan media video.";
    default:
      return "Video tidak dapat diputar. Periksa koneksi lalu coba lagi.";
  }
}
