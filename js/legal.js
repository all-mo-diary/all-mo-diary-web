// Same text as the copy bundled in the app (meta repo: tools/sync_texts.sh copies it here).
(function () {
  const docs = { terms: "使用者條款", privacy: "隱私權政策" };
  const doc = new URLSearchParams(location.search).get("doc");
  const box = document.getElementById("content");
  if (!Object.prototype.hasOwnProperty.call(docs, doc)) {
    box.innerHTML = '<p>找不到這份文件。<a href="index.html">回首頁</a></p>';
    return;
  }
  document.title = docs[doc] + " - 全心日記";
  document.getElementById("title").textContent = docs[doc];
  fetch("legal/" + doc + ".md", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(); return r.text(); })
    .then((md) => { box.innerHTML = window.renderMarkdown(md); })
    .catch(() => { box.innerHTML = "<p>載入失敗，請重新整理。</p>"; });
})();
