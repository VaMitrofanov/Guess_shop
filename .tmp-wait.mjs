const apiBase = "http://89.110.94.117:8000/api/v1";
const token = process.env.COOLIFY_TOKEN;
const apps = { web:"z10ws7m1q45h281zwedmhei4", tg:"lyz78enntugna9em1biopinr", vk:"gmtpfqosgoz23vjyxyczuic9" };
for (let i = 0; i < 60; i += 1) {
  const out = []; let done = true;
  for (const [n,u] of Object.entries(apps)) {
    const r = await fetch(`${apiBase}/deployments/applications/${u}?take=1`, { headers:{Authorization:`Bearer ${token}`}, signal: AbortSignal.timeout(25000) }).catch(()=>null);
    const b = r&&r.ok ? await r.json().catch(()=>null) : null;
    const d = (Array.isArray(b)?b:b?.deployments??[])[0];
    out.push(`${n}=${d?.status}(${(d?.commit||"").slice(0,7)})`);
    if (d?.commit?.slice(0,7)!=="345d1c4" || !["finished","failed","cancelled"].includes(d.status)) done = false;
  }
  console.log(out.join(" "));
  if (done) break;
  await new Promise(r=>setTimeout(r,20000));
}
