document.addEventListener('DOMContentLoaded', () => {
    const bioContainer = document.getElementById('bio-container');
    const articleContainer = document.getElementById('article-container');
    const container = document.getElementById('container');
    const pageConfig = document.body.dataset;

    bioContainer.classList.add('markdown-body');
    articleContainer.classList.add('markdown-body');

    function projectRoot() {
        const path = window.location.pathname;
        const templatesIndex = path.indexOf('/templates/');
        if (templatesIndex !== -1) {
            return path.slice(0, templatesIndex + 1);
        }
        const dir = path.substring(0, path.lastIndexOf('/') + 1);
        return dir || '/';
    }

    function assetUrl(relativePath) {
        const root = projectRoot();
        const clean = relativePath.replace(/^\.\//, '');
        return `${root}${clean}`.replace(/\/{2,}/g, '/');
    }

    const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];

    function findImage(baseName) {
        return IMAGE_EXTENSIONS.reduce((chain, ext) => {
            return chain.then(found => {
                if (found) return found;
                const url = assetUrl(`image/${baseName}.${ext}`);
                return fetch(url, { method: 'HEAD' })
                    .then(res => (res.ok ? url : null))
                    .catch(() => null);
            });
        }, Promise.resolve(null));
    }

    function showError(message) {
        const hint = window.location.pathname.includes('/templates/')
            ? ''
            : '<br><small>Astuce : lancez le serveur depuis le dossier <strong>Bran web source</strong>, pas depuis <strong>templates/</strong>.</small>';
        const html = `<p class="error">Erreur critique : ${message}${hint}</p>`;
        bioContainer.innerHTML = html;
        articleContainer.innerHTML = html;
    }

    Promise.all([
        fetch(assetUrl('bio.md')).then(res => {
            if (!res.ok) throw new Error('bio.md introuvable — serveur à lancer depuis Bran web source/');
            return res.text();
        }),
        fetch(assetUrl('source.md')).then(res => {
            if (!res.ok) throw new Error('source.md introuvable — serveur à lancer depuis Bran web source/');
            return res.text();
        }),
        findImage('photo1up'),
        findImage('photo2down')
    ])
    .then(([bioMd, sourceMd, headerImg, footerImg]) => {
        if (headerImg) {
            const img = document.createElement('img');
            img.src = headerImg;
            img.alt = pageConfig.headerAlt || 'Photo d\'en-tête';
            img.className = 'header-img';
            container.insertBefore(img, bioContainer);
        }

        bioContainer.innerHTML = marked.parse(bioMd);
        articleContainer.innerHTML = marked.parse(sourceMd);

        if (footerImg) {
            const img = document.createElement('img');
            img.src = footerImg;
            img.alt = pageConfig.footerAlt || 'Pied de page';
            img.className = 'footer-img';
            container.appendChild(img);
        }

        console.log(pageConfig.consoleLog || 'Bran Web : chargement réussi.');
    })
    .catch(err => {
        console.error('Erreur Venardi :', err);
        showError(err.message);
    });
});
