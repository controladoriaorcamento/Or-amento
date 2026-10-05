/* Adaptador: faz o formulário (feito para o Claude) funcionar com Supabase.
   Implementa claude.use("db" | "user" | "downloads") sobre a tabela public.docs
   e o login: 1º acesso só com o e-mail da lista (cria a senha); depois e-mail + senha.
   Nenhum e-mail é enviado. Quem não está na aba "3. Gerentes" (tabela acessos) nem em admins não entra. */
(function(){
  const C=window.ORC_CONFIG||{};
  const sb=window.supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY,{auth:{persistSession:true,detectSessionInUrl:false}});
  window.ORC_SB=sb;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const err=(e,ctx)=>{if(e){console.error(ctx,e);throw new Error((e.message||e)+" ("+ctx+")")}};
  const snap=(path,row)=>({id:path.split("/").pop(),exists:!!row,data:()=>row?clone(row.data):undefined});
  async function getDoc(path){const {data,error}=await sb.from("docs").select("path,data").eq("path",path).maybeSingle();err(error,"ler "+path);return snap(path,data)}
  async function setDoc(path,v){const {error}=await sb.from("docs").upsert({path,data:clone(v)},{onConflict:"path"});err(error,"gravar "+path)}
  const db={
    doc:path=>({
      get:()=>getDoc(path),
      set:v=>setDoc(path,v),
      update:async v=>{const s=await getDoc(path);await setDoc(path,{...(s.exists?s.data():{}),...clone(v)})},
      delete:async()=>{const {error}=await sb.from("docs").delete().eq("path",path);err(error,"apagar "+path)}
    }),
    collection:path=>({get:async()=>{
      const rows=[];let from=0;const step=1000;
      for(;;){const {data,error}=await sb.from("docs").select("path,data").eq("parent",path).order("path").range(from,from+step-1);err(error,"listar "+path);rows.push(...data);if(data.length<step)break;from+=step}
      const docs=rows.map(r=>snap(r.path,r));return {docs,size:docs.length,empty:!docs.length,forEach:f=>docs.forEach(f)}
    }})
  };
  let sess=null,admin=false;
  const user={
    id:async()=>sess&&sess.user.id,
    isOwner:async()=>admin,canEdit:async()=>admin,
    me:async()=>({id:sess&&sess.user.id,name:(sess&&sess.user.email)||""}),
    profiles:async ids=>{ids=[].concat(ids).filter(Boolean);if(!ids.length)return {};
      const {data,error}=await sb.from("perfis").select("uid,email,nome").in("uid",ids);if(error)return {};
      return Object.fromEntries(data.map(p=>[p.uid,{id:p.uid,name:p.nome||p.email,email:p.email}]))},
    search:async q=>{const {data}=await sb.from("perfis").select("uid,email,nome").or(`nome.ilike.%${q}%,email.ilike.%${q}%`).limit(20);return (data||[]).map(p=>({id:p.uid,name:p.nome||p.email,email:p.email}))}
  };
  const downloads={save:async({filename,data})=>{const b=data instanceof Blob?data:new Blob([data]);const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);return {status:"saved"}}};
  window.claude={use:async n=>({db,user,downloads})[n]||null};

  /* tabela de acessos (aba "3. Gerentes"), gravada quando a Controladoria carrega a CONFIGURAÇÃO */
  window.ORC_HOOKS={acessos:async lista=>{
    const rows=[];lista.forEach(p=>Object.entries(p.acc||{}).forEach(([obra_id,deps])=>deps.forEach(d=>rows.push({email:p.email.toLowerCase(),obra_id,departamento:d,nome:p.nome||null,cargo:p.cargo||null}))));
    let r=await sb.from("acessos").delete().neq("email","");err(r.error,"limpar acessos");
    for(let i=0;i<rows.length;i+=500){r=await sb.from("acessos").insert(rows.slice(i,i+500));err(r.error,"gravar acessos")}
  }};

  /* tela de login: e-mail -> (novo) criar senha | (cadastrado) senha */
  const est="width:100%;box-sizing:border-box;margin:6px 0 12px;padding:10px;border:1px solid #B9C4BD;border-radius:6px;font-size:15px";
  const btn="width:100%;padding:10px;border:0;border-radius:6px;background:#1F5C4A;color:#fff;font-size:15px;cursor:pointer";
  function telaLogin(msg){
    return new Promise(()=>{
      const box=document.createElement("div");box.id="login-box";
      box.innerHTML=`<div style="position:fixed;inset:0;background:var(--bg,#F2F4F1);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:'IBM Plex Sans',system-ui,sans-serif">
        <form id="lg-form" style="background:#fff;border:1px solid #D7DED9;border-radius:10px;padding:28px;width:min(420px,92vw)" autocomplete="on">
          <h1 style="margin:0 0 4px;font-size:22px">Orçamento 2027–2029</h1>
          <p style="margin:0 0 18px;color:#5A6862;font-size:14px">Brasil Terrenos · Controladoria</p>
          <label style="font-size:13px;color:#5A6862">Seu e-mail</label>
          <input id="lg-email" name="email" type="email" autocomplete="username" required style="${est}">
          <div id="lg-p1" hidden><label id="lg-l1" style="font-size:13px;color:#5A6862">Senha</label>
            <input id="lg-s1" type="password" autocomplete="current-password" style="${est}"></div>
          <div id="lg-p2" hidden><label style="font-size:13px;color:#5A6862">Repita a senha</label>
            <input id="lg-s2" type="password" autocomplete="new-password" style="${est}"></div>
          <button id="lg-ok" type="submit" style="${btn}">Continuar</button>
          <p id="lg-msg" style="margin:12px 0 0;font-size:13px;color:#5A6862">${msg||"Use o e-mail cadastrado pela Controladoria."}</p>
          <p style="margin:10px 0 0;font-size:12px"><a href="#" id="lg-trocar" hidden>Usar outro e-mail</a></p>
        </form></div>`;
      document.body.appendChild(box);const lv=document.getElementById("v-loading");if(lv)lv.hidden=true;
      const $=id=>document.getElementById(id),m=$("lg-msg");let modo="email",em="";
      const fase=f=>{modo=f;$("lg-p1").hidden=f==="email";$("lg-p2").hidden=f!=="novo";$("lg-email").readOnly=f!=="email";$("lg-trocar").hidden=f==="email";
        $("lg-l1").textContent=f==="novo"?"Crie uma senha (mínimo 8 caracteres)":"Senha";$("lg-s1").autocomplete=f==="novo"?"new-password":"current-password";
        $("lg-ok").textContent=f==="email"?"Continuar":f==="novo"?"Criar senha e entrar":"Entrar";if(f!=="email")setTimeout(()=>$("lg-s1").focus(),0)};
      $("lg-trocar").onclick=e=>{e.preventDefault();$("lg-s1").value=$("lg-s2").value="";m.textContent="";fase("email")};
      $("lg-form").onsubmit=async e=>{e.preventDefault();const b=$("lg-ok");b.disabled=true;
        try{
          if(modo==="email"){em=$("lg-email").value.trim().toLowerCase();
            const {data,error}=await sb.rpc("email_status",{p:em});if(error)throw error;
            if(data==="negado"){m.textContent="Este e-mail não está liberado para o Orçamento 2027–2029. Fale com a Controladoria.";return}
            m.textContent=data==="novo"?"Primeiro acesso: crie a sua senha.":"Digite a sua senha.";fase(data);return}
          const s1=$("lg-s1").value;
          if(modo==="novo"){
            if(s1.length<8){m.textContent="A senha precisa ter pelo menos 8 caracteres.";return}
            if(s1!==$("lg-s2").value){m.textContent="As duas senhas não são iguais.";return}
            const {data,error}=await sb.auth.signUp({email:em,password:s1});if(error)throw error;
            if(!data.session){m.textContent="Senha criada, mas o acesso não abriu (confirmação de e-mail ligada no Supabase). Fale com a Controladoria.";return}
          }else{
            const {error}=await sb.auth.signInWithPassword({email:em,password:s1});
            if(error){m.textContent=/invalid/i.test(error.message)?"Senha incorreta. Esqueceu? Peça à Controladoria para zerar a sua senha.":error.message;return}
          }
          location.reload();
        }catch(x){m.textContent="Não foi possível entrar: "+(x.message||x)}finally{b.disabled=false}};
    });
  }
  /* carga inicial (só admin): envia docs.jsonl e acessos.json do pacote de dados usando a sessão do próprio admin */
  function botaoCarga(){
    const w=document.createElement("div");w.style.cssText="position:fixed;left:12px;bottom:12px;z-index:50;font:12px 'IBM Plex Sans',sans-serif;background:#fff;border:1px solid #D7DED9;border-radius:6px;padding:6px 8px";
    w.innerHTML=`<label style="cursor:pointer">⤓ Carga de dados (admin) <input id="carga-f" type="file" multiple accept=".jsonl,.json" hidden></label> <span id="carga-m" style="color:#5A6862"></span>`;
    document.body.appendChild(w);
    w.querySelector("#carga-f").addEventListener("change",async e=>{const m=w.querySelector("#carga-m");const fs=[...e.target.files];e.target.value="";
      try{for(const f of fs){const txt=await f.text();
        if(/\.jsonl$/i.test(f.name)){const docs=txt.split("\n").filter(Boolean).map(l=>JSON.parse(l));let lote=[],tam=0,n=0;
          const envia=async()=>{if(!lote.length)return;const {error}=await sb.from("docs").upsert(lote,{onConflict:"path"});err(error,"carga docs");n+=lote.length;m.textContent=`${n}/${docs.length} documentos…`;lote=[];tam=0};
          for(const d of docs){const s=JSON.stringify(d).length;if(tam+s>1500000||lote.length>=200)await envia();lote.push({path:d.path,data:d.data});tam+=s}await envia();}
        else if(/acessos/i.test(f.name)){const rows=JSON.parse(txt);let r=await sb.from("acessos").delete().neq("email","");err(r.error,"limpar acessos");
          for(let i=0;i<rows.length;i+=500){r=await sb.from("acessos").insert(rows.slice(i,i+500));err(r.error,"gravar acessos")}m.textContent+=` · ${rows.length} acessos`}}
        m.textContent+=" · concluído. Recarregue a página.";}catch(x){m.textContent="Erro: "+x.message}});
  }
  window.ORC_PRE=async()=>{
    const {data}=await sb.auth.getSession();sess=data.session;
    if(!sess)return telaLogin();   // fica na tela de login até voltar pelo link
    const em=(sess.user.email||"").toLowerCase();
    const r=await sb.rpc("liberar_meus_acessos");
    if(r.error){console.warn("liberar_meus_acessos",r.error);await sb.auth.signOut();return telaLogin("Este e-mail não está liberado para o Orçamento 2027–2029.")}
    admin=!!(r.data&&r.data.admin);
    // botão sair
    const b=document.createElement("button");b.textContent="Sair ("+em+")";b.className="btn";b.style.cssText="position:fixed;right:12px;bottom:12px;z-index:50;font-size:12px";
    b.onclick=async()=>{await sb.auth.signOut();location.reload()};document.body.appendChild(b);
    if(admin)botaoCarga();
  };
})();
