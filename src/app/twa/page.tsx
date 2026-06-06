import TwaApp from "./_components/TwaApp";

export default function TwaPage() {
  return (
    <>
      <div id="__twa_err" style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 99999,
        background: "#1a0000", color: "#ff453a", fontSize: 11, padding: "6px 10px",
        fontFamily: "monospace", display: "none",
      }} />
      <script dangerouslySetInnerHTML={{ __html: `
        try{window.Telegram&&window.Telegram.WebApp&&window.Telegram.WebApp.ready()}catch(e){}
        var el=document.getElementById('__twa_err');
        if(el){el.style.display='none';window.addEventListener('error',function(e){el.style.display='block';el.textContent='ERR: '+e.message+' @ '+e.filename+':'+e.lineno});}
      ` }} />
      <TwaApp />
    </>
  );
}
