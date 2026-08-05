var e=class e extends HTMLElement{constructor(){super(),this.isIframeLoaded=!1,this.isPlaylistThumbnailLoaded=!1,this.setupDom()}static get observedAttributes(){return[`videoid`,`playlistid`,`videoplay`,`videotitle`]}connectedCallback(){this.addEventListener(`pointerover`,()=>e.warmConnections(this),{once:!0}),this.addEventListener(`click`,()=>this.addIframe())}get videoId(){return encodeURIComponent(this.getAttribute(`videoid`)||``)}set videoId(e){this.setAttribute(`videoid`,e)}get playlistId(){return encodeURIComponent(this.getAttribute(`playlistid`)||``)}set playlistId(e){this.setAttribute(`playlistid`,e)}get videoTitle(){return this.getAttribute(`videotitle`)||`Video`}set videoTitle(e){this.setAttribute(`videotitle`,e)}get videoPlay(){return this.getAttribute(`videoplay`)||`Play`}set videoPlay(e){this.setAttribute(`videoplay`,e)}get videoStartAt(){return this.getAttribute(`videoStartAt`)||`0`}get autoLoad(){return this.hasAttribute(`autoload`)}get autoPause(){return this.hasAttribute(`autopause`)}get noCookie(){return this.hasAttribute(`nocookie`)}get posterQuality(){return this.getAttribute(`posterquality`)||`hqdefault`}get posterLoading(){return this.getAttribute(`posterloading`)||`lazy`}get params(){return`start=${this.videoStartAt}&${this.getAttribute(`params`)}`}set params(e){this.setAttribute(`params`,e)}set posterQuality(e){this.setAttribute(`posterquality`,e)}get disableNoscript(){return this.hasAttribute(`disablenoscript`)}setupDom(){let e=this.attachShadow({mode:`open`}),t=``;window.liteYouTubeNonce&&(t=`nonce="${window.liteYouTubeNonce}"`),e.innerHTML=`
      <style ${t}>
        :host {
          --aspect-ratio: var(--lite-youtube-aspect-ratio, 16 / 9);
          --aspect-ratio-short: var(--lite-youtube-aspect-ratio-short, 9 / 16);
          --frame-shadow-visible: var(--lite-youtube-frame-shadow-visible, yes);
          contain: content;
          display: block;
          position: relative;
          width: 100%;
          aspect-ratio: var(--aspect-ratio);
        }

        @media (max-width: 40em) {
          :host([short]) {
            aspect-ratio: var(--aspect-ratio-short);
          }
        }

        #frame, #fallbackPlaceholder, iframe {
          position: absolute;
          width: 100%;
          height: 100%;
          left: 0;
          top: 0;
        }

        #frame {
          cursor: pointer;
        }

        #fallbackPlaceholder, slot[name=image]::slotted(*) {
          object-fit: cover;
          width: 100%;
          height: 100%;
        }

        @container style(--frame-shadow-visible: yes) {
          #frame::before {
            content: '';
            display: block;
            position: absolute;
            top: 0;
            background-image: linear-gradient(180deg, #111 -20%, transparent 90%);
            height: 60px;
            width: 100%;
            z-index: 1;
          }
        }

        #playButton {
          width: 68px;
          height: 48px;
          background-color: transparent;
          background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="red"/><path d="M45 24 27 14v20" fill="white"/></svg>');
          z-index: 1;
          border: 0;
          border-radius: inherit;
        }

        #playButton:before {
          content: '';
          border-style: solid;
          border-width: 11px 0 11px 19px;
          border-color: transparent transparent transparent #fff;
        }

        #playButton,
        #playButton:before {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate3d(-50%, -50%, 0);
          cursor: inherit;
        }

        /* Post-click styles */
        .activated {
          cursor: unset;
        }

        #frame.activated::before,
        #frame.activated > #playButton {
          display: none;
        }
      </style>
      <div id="frame">
        <picture>
          <slot name="image">
            <source id="webpPlaceholder" type="image/webp">
            <source id="jpegPlaceholder" type="image/jpeg">
            <img id="fallbackPlaceholder" referrerpolicy="origin" loading="lazy">
          </slot>
        </picture>
        <button id="playButton" part="playButton"></button>
      </div>
    `,this.domRefFrame=e.querySelector(`#frame`),this.domRefImg={fallback:e.querySelector(`#fallbackPlaceholder`),webp:e.querySelector(`#webpPlaceholder`),jpeg:e.querySelector(`#jpegPlaceholder`)},this.domRefPlayButton=e.querySelector(`#playButton`)}setupComponent(){this.shadowRoot.querySelector(`slot[name=image]`).assignedNodes().length===0&&this.initImagePlaceholder(),this.domRefPlayButton.setAttribute(`aria-label`,`${this.videoPlay}: ${this.videoTitle}`),this.setAttribute(`title`,`${this.videoPlay}: ${this.videoTitle}`),(this.autoLoad||this.isYouTubeShort()||this.autoPause)&&this.initIntersectionObserver(),this.disableNoscript||this.injectSearchNoScript()}attributeChangedCallback(e,t,n){t!==n&&(e===`playlistid`&&t!==null&&t!==n&&(this.isPlaylistThumbnailLoaded=!1),this.setupComponent(),this.domRefFrame.classList.contains(`activated`)&&(this.domRefFrame.classList.remove(`activated`),this.shadowRoot.querySelector(`iframe`).remove(),this.isIframeLoaded=!1))}injectSearchNoScript(){let e=document.createElement(`noscript`);this.prepend(e),e.innerHTML=this.generateIframe()}generateIframe(e=!1){let t=+!e,n=this.autoPause?`&enablejsapi=1`:``,r=this.noCookie?`-nocookie`:``,i;return i=this.playlistId?`?listType=playlist&list=${this.playlistId}&`:`${this.videoId}?`,this.isYouTubeShort()&&(this.params=`loop=1&mute=1&modestbranding=1&playsinline=1&rel=0&enablejsapi=1&playlist=${this.videoId}`,t=1),`
<iframe credentialless frameborder="0" title="${this.videoTitle}"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen
  src="https://www.youtube${r}.com/embed/${i}autoplay=${t}${n}&${this.params}"
></iframe>`}addIframe(e=!1){if(!this.isIframeLoaded){let t=this.generateIframe(e);this.domRefFrame.insertAdjacentHTML(`beforeend`,t),this.domRefFrame.classList.add(`activated`),this.isIframeLoaded=!0,this.attemptShortAutoPlay(),this.dispatchEvent(new CustomEvent(`liteYoutubeIframeLoaded`,{detail:{videoId:this.videoId},bubbles:!0,cancelable:!0}))}}initImagePlaceholder(){this.playlistId&&!this.videoId?this.loadPlaylistThumbnail():this.testPosterImage(),this.domRefImg.fallback.setAttribute(`aria-label`,`${this.videoPlay}: ${this.videoTitle}`),this.domRefImg?.fallback?.setAttribute(`alt`,`${this.videoPlay}: ${this.videoTitle}`)}async loadPlaylistThumbnail(){if(!this.isPlaylistThumbnailLoaded){this.isPlaylistThumbnailLoaded=!0;try{let e=`https://www.youtube.com/oembed?url=https://www.youtube.com/playlist?list=${this.playlistId}&format=json`,t=await fetch(e);if(!t.ok)throw Error(`Failed to fetch playlist thumbnail: ${t.status}`);let n=await t.json();if(n.thumbnail_url){let e=n.thumbnail_url,t=e.match(/\/vi\/([^\/]+)\//);if(t){let e=t[1];this.loadThumbnailImages(e)}else this.domRefImg.fallback.src=e,this.domRefImg.fallback.loading=this.posterLoading}}catch(e){console.warn(`Failed to load playlist thumbnail:`,e)}}}loadThumbnailImages(e){let t=`https://i.ytimg.com/vi_webp/${e}/${this.posterQuality}.webp`;this.domRefImg.webp.srcset=t;let n=`https://i.ytimg.com/vi/${e}/${this.posterQuality}.jpg`;this.domRefImg.jpeg.srcset=n,this.domRefImg.fallback.src=n,this.domRefImg.fallback.loading=this.posterLoading}async testPosterImage(){setTimeout(()=>{let e=`https://i.ytimg.com/vi_webp/${this.videoId}/${this.posterQuality}.webp`,t=new Image;t.fetchPriority=`low`,t.referrerPolicy=`origin`,t.src=e,t.onload=async e=>{let t=e.target;t?.naturalHeight==90&&t?.naturalWidth==120&&(this.posterQuality=`hqdefault`),this.loadThumbnailImages(this.videoId)}},100)}initIntersectionObserver(){new IntersectionObserver((t,n)=>{t.forEach(t=>{t.isIntersecting&&!this.isIframeLoaded&&(e.warmConnections(this),this.addIframe(!0),n.unobserve(this))})},{root:null,rootMargin:`0px`,threshold:0}).observe(this),this.autoPause&&new IntersectionObserver((e,t)=>{e.forEach(e=>{e.intersectionRatio!==1&&this.shadowRoot.querySelector(`iframe`)?.contentWindow?.postMessage(`{"event":"command","func":"pauseVideo","args":""}`,`*`)})},{threshold:1}).observe(this)}attemptShortAutoPlay(){this.isYouTubeShort()&&setTimeout(()=>{this.shadowRoot.querySelector(`iframe`)?.contentWindow?.postMessage(`{"event":"command","func":"playVideo","args":""}`,`*`)},2e3)}isYouTubeShort(){return this.getAttribute(`short`)===``&&window.matchMedia(`(max-width: 40em)`).matches}static addPrefetch(e,t){let n=document.createElement(`link`);n.rel=e,n.href=t,n.crossOrigin=`true`,document.head.append(n)}static warmConnections(t){e.isPreconnected||window.liteYouTubeIsPreconnected||(e.addPrefetch(`preconnect`,`https://i.ytimg.com/`),e.addPrefetch(`preconnect`,`https://s.ytimg.com`),t.noCookie?e.addPrefetch(`preconnect`,`https://www.youtube-nocookie.com`):(e.addPrefetch(`preconnect`,`https://www.youtube.com`),e.addPrefetch(`preconnect`,`https://www.google.com`),e.addPrefetch(`preconnect`,`https://googleads.g.doubleclick.net`),e.addPrefetch(`preconnect`,`https://static.doubleclick.net`)),e.isPreconnected=!0,window.liteYouTubeIsPreconnected=!0)}};e.isPreconnected=!1,customElements.define(`lite-youtube`,e);