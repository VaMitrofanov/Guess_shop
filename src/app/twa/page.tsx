import TwaApp from "./_components/TwaApp";

// Статический пререндер отдавал /twa с `s-maxage=31536000`: после деплоя
// закешированный HTML ссылался на удалённые immutable-чанки → ChunkLoadError,
// гидрация не происходила, оставался SSR-скелет без нижнего бара и с мёртвыми
// кнопками. Рендерим страницу на каждый запрос — HTML крошечный, зато всегда
// указывает на живые чанки текущего деплоя.
export const dynamic = "force-dynamic";

export default function TwaPage() {
  return (
    <>
      <div id="__twa_err" style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 99999,
        background: "#1a0000", color: "#ff453a", fontSize: 11, padding: "6px 10px",
        fontFamily: "monospace", display: "none",
      }} />
      <script dangerouslySetInnerHTML={{ __html: `
        window.__tgHash=location.hash;
        try{window.Telegram&&window.Telegram.WebApp&&window.Telegram.WebApp.ready()}catch(e){}
        var el=document.getElementById('__twa_err');
        if(el){el.style.display='none';window.addEventListener('error',function(e){el.style.display='block';el.textContent='ERR: '+e.message+' @ '+e.filename+':'+e.lineno});}
        // Самолечение протухшего HTML: чанк прошлого деплоя удалён с сервера →
        // одна автоперезагрузка страницы подтягивает свежий HTML с живыми чанками.
        (function(){
          var RX=/Loading chunk|ChunkLoadError|dynamically imported module|Importing a module script failed/i;
          function heal(msg){
            if(!RX.test(String(msg||'')))return;
            var t=+sessionStorage.getItem('twa_chunk_reload')||0;
            if(Date.now()-t<60000)return;
            sessionStorage.setItem('twa_chunk_reload',String(Date.now()));
            location.reload();
          }
          window.addEventListener('error',function(e){heal(e.message)},true);
          window.addEventListener('unhandledrejection',function(e){heal(e.reason&&e.reason.message||e.reason)});
        })();
      ` }} />
      <TwaApp />
    </>
  );
}
