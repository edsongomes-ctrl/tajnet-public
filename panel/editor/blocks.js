/* global grapesjs — blocs GrapesJS TajNet */
function registerTajnetBlocks(editor) {
  const bm = editor.BlockManager;

  bm.add("text-basic", {
    label: "📝 Texte",
    category: "Basique",
    content: '<div data-gjs-type="text">Insérez votre texte ici</div>',
  });

  bm.add("link-basic", { label: "🔗 Lien", category: "Basique", content: '<a href="#">Lien</a>' });
  bm.add("image-basic", { label: "🖼️ Image", category: "Basique", content: { type: "image" }, activate: true });
  bm.add("video-basic", {
    label: "🎥 Vidéo",
    category: "Basique",
    content: '<video controls style="max-width:100%"><source src="" type="video/mp4"></video>',
  });
  bm.add("map-basic", {
    label: "🗺️ Carte",
    category: "Basique",
    content:
      '<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2624.99!2d2.2922926!3d48.8583701!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47e66e2964e34e2d%3A0x8ddca9ee380ef7e0!2sTour%20Eiffel!5e0!3m2!1sfr!2sfr" style="border:0;width:100%;height:450px" allowfullscreen loading="lazy"></iframe>',
  });
  bm.add("column1", {
    label: "1 Colonne",
    category: "Basique",
    content: '<div style="padding:10px;min-height:75px">Colonne</div>',
  });
  bm.add("column2", {
    label: "2 Colonnes",
    category: "Basique",
    content:
      '<div style="display:flex;gap:10px;padding:10px"><div style="flex:1;min-height:75px">Colonne 1</div><div style="flex:1;min-height:75px">Colonne 2</div></div>',
  });
  bm.add("column3", {
    label: "3 Colonnes",
    category: "Basique",
    content:
      '<div style="display:flex;gap:10px;padding:10px"><div style="flex:1;min-height:75px">Col. 1</div><div style="flex:1;min-height:75px">Col. 2</div><div style="flex:1;min-height:75px">Col. 3</div></div>',
  });

  bm.add("hero-section", {
    label: "🎯 Hero",
    category: "Sections",
    content:
      '<section style="padding:80px 20px;text-align:center;background:linear-gradient(135deg,#0a0a0a,#1a3a1a);color:#00ff41"><h1 style="font-size:3em;margin-bottom:20px">Titre Principal</h1><p style="font-size:1.2em;margin-bottom:30px;color:#aaa">Sous-titre accrocheur</p><a href="#" style="display:inline-block;padding:15px 40px;background:#00ff41;color:#0a0a0a;text-decoration:none;border-radius:50px;font-weight:bold">Appel à l\'action</a></section>',
  });
  bm.add("card-grid", {
    label: "📦 Grille",
    category: "Sections",
    content:
      '<section style="padding:60px 20px;background:#111"><div style="max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:30px"><div style="background:#0a0a0a;padding:30px;border:1px solid #333;border-radius:8px"><h3 style="color:#00ff41;margin-top:0">Carte 1</h3><p style="color:#888">Description</p></div><div style="background:#0a0a0a;padding:30px;border:1px solid #333;border-radius:8px"><h3 style="color:#00ff41;margin-top:0">Carte 2</h3><p style="color:#888">Description</p></div><div style="background:#0a0a0a;padding:30px;border:1px solid #333;border-radius:8px"><h3 style="color:#00ff41;margin-top:0">Carte 3</h3><p style="color:#888">Description</p></div></div></section>',
  });
  bm.add("contact-form", {
    label: "📧 Contact",
    category: "Formulaires",
    content:
      '<section style="padding:60px 20px;background:#0a0a0a"><div style="max-width:600px;margin:0 auto"><h2 style="text-align:center;color:#fff;margin-bottom:40px">Contactez-nous</h2><form style="display:flex;flex-direction:column;gap:20px"><input type="text" placeholder="Nom" style="padding:15px;background:#111;border:1px solid #333;color:#fff;border-radius:5px"><input type="email" placeholder="Email" style="padding:15px;background:#111;border:1px solid #333;color:#fff;border-radius:5px"><textarea placeholder="Message" rows="5" style="padding:15px;background:#111;border:1px solid #333;color:#fff;border-radius:5px"></textarea><button type="submit" style="padding:15px;background:#00ff41;color:#0a0a0a;border:none;border-radius:5px;font-weight:bold;cursor:pointer">Envoyer</button></form></div></section>',
  });
  bm.add("footer", {
    label: "🦶 Footer",
    category: "Sections",
    content:
      '<footer style="padding:60px 20px 30px;background:#0a0a0a;color:#888;border-top:1px solid #333"><div style="max-width:1200px;margin:0 auto;text-align:center"><p>© 2025 TajNet — Publié sur IPFS</p></div></footer>',
  });

  bm.add("heading-h1", {
    label: "H1",
    category: "Texte",
    content: '<h1 style="font-size:2.5em;color:#fff;margin:20px 0">Titre principal</h1>',
  });
  bm.add("heading-h2", {
    label: "H2",
    category: "Texte",
    content: '<h2 style="font-size:2em;color:#fff;margin:18px 0">Sous-titre</h2>',
  });
  bm.add("paragraph", {
    label: "📝 Paragraphe",
    category: "Texte",
    content: '<p style="font-size:1em;line-height:1.6;color:#aaa;margin:15px 0">Paragraphe de texte modifiable.</p>',
  });
  bm.add("blockquote", {
    label: "💭 Citation",
    category: "Texte",
    content:
      '<blockquote style="border-left:4px solid #00ff41;padding-left:20px;margin:20px 0;font-style:italic;color:#888">"Citation inspirante"</blockquote>',
  });
  bm.add("divider", {
    label: "➖ Séparateur",
    category: "Texte",
    content: '<hr style="border:none;border-top:1px solid #333;margin:30px 0">',
  });
  bm.add("link-button", {
    label: "🔘 Bouton",
    category: "Liens",
    content:
      '<a href="#" style="display:inline-block;padding:12px 30px;background:#00ff41;color:#0a0a0a;text-decoration:none;border-radius:5px;font-weight:bold">Cliquez ici</a>',
  });
  bm.add("image-simple", {
    label: "🖼️ Image",
    category: "Images",
    content:
      '<img src="https://via.placeholder.com/600x400/111/00ff41?text=TajNet" alt="Image" style="max-width:100%;height:auto;border-radius:8px">',
  });
  bm.add("list-unordered", {
    label: "📋 Liste",
    category: "Listes",
    content:
      '<ul style="line-height:1.8;color:#aaa;margin:20px 0;padding-left:30px"><li>Premier élément</li><li>Deuxième élément</li><li>Troisième élément</li></ul>',
  });
  bm.add("spacer-medium", {
    label: "⬇️ Espacement",
    category: "Espacement",
    content: '<div style="height:40px"></div>',
  });
}
