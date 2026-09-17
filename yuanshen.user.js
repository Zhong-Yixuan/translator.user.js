// ==UserScript==
// @name         以此缅怀伟大的康老师
// @namespace    http://tampermonkey.net/
// @version      2.0
// @downloadURL  https://github.com/Zhong-Yixuan/translator.user.js/main/yuanshen.user.js
// @updateURL    https://github.com/Zhong-Yixuan/translator.user.js/main/yuanshen.user.js
// @description  Select text, wait 3 seconds, see meaning; drag the popup by its top bar
// @author       Zhong_Yixuan
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // ATTENTION!!! must be lower case (or modify the code in line 308)
    let Zyx_PartOfSpeech = [
        "symbol", // such as '+' (also in 'the', unknow why so far)
        "obsolete", // no longer for use
        "archaic", // too old fasion
        "alternative", //unknow so far, it is orgnized by deepseek.
        "form_of", // which means it is the form in some tense(when the text is 'did', it will return 'do').
        "article", // only when text is 'a', 'an', 'the'
        "pronoun", // NOT FOR ENGLISH BEGINNER (you can try in 'the')
        "preposition" //介词
    ];

    let explanation_Show = 1;

    let FLAG = 0;
    let TIME = 100;

    // ---------- Core state variables ----------
    let selectionTimeout = null;   // holds the 3-second timer ID
    let popupElement = null;       // the floating box (DOM element)
    let atten = null;
    let pendingText = '';          // the text we are currently waiting to explan

    // ---------- Drag-related variables ----------
    let isDragging = false;        // true while the user is dragging the popup
    let dragOffsetX = 0;           // horizontal distance from mouse to popup's left edge
    let dragOffsetY = 0;           // vertical distance from mouse to popup's top edge
    let justDragged = false;       // becomes true after a drag ends, to prevent hiding

    // ---------- Helper: escape HTML to avoid XSS attacks ----------
    // Converts <, >, &, ", ' into harmless text codes.
    function escapeHTML(str) {
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }

    // ---------- Hide and remove the popup completely ----------
    function hidePopup() {
        if (popupElement) {
            popupElement.remove();
            popupElement = null;
        }
        // Also reset any dragging state
        isDragging = false;
        justDragged = false;
        FLAG = 0;
    }
    function attention(text) {
        const attentin = document.createElement('div');
        const na = Math.floor(Math.random() * 50)+70;
        const nb = Math.floor(Math.random()*50)+70;
        attentin.style.cssText = `
        position: absolute;
        top: ${na}px;
        left: ${nb}px;
        background: green;
        margin: 10px;
        height: 10px;
        z-index: 99999;
        //border-radius:5px;
        display: inline-block;
        `
        attentin.innerHTML = `<p style="font-size:50px;color:blue;background-color:red;opacity:0.5;padding:10px;">${text || 'attention'}</p>`;
        document.body.appendChild(attentin);
    }

    // ---------- Show (or update) the popup at a certain position ----------
    // rect   = the bounding rectangle of the selected text (from getBoundingClientRect)
    // contentHTML = the HTML to show inside (can be "Loading...")
    function showPopup(rect, contentHTML) {// rect is the position it should be.
        //hidePopup();   // always remove any old box first

        // Create the main container
        const popup = document.createElement('div');
        popup.id = 'text-explaner-popup';

        // ---------- 1. The drag handle (the top bar you can grab) ----------

        const dragHandle = document.createElement('div');
        dragHandle.className = 'explaner-drag-handle';

        // Style for the drag handle (grey bar, grab cursor)
        dragHandle.style.cssText = `
            //background: #f0f0f0;
            //border-bottom: 1px solid #ccc;
            border-radius: 8px 8px 0 0;
            padding: 10px 12px;
            cursor: grab;  /* change your cursor style to an open hand*/
            //height: 24px;
            //color: #555;
            user-select: none;          /* Prevent text selection while dragging*/
            display: flex;
            align-items: center;
        `;
        // Change cursor to "grabbing" while we are actually dragging
        // We'll do that in the drag event functions later.

        // ---------- 2. The close button (X) ----------
        const closeBtn = document.createElement('span');
        closeBtn.textContent = '×';
        closeBtn.title = 'Close';
        closeBtn.style.cssText = `
            position: absolute;
            top: 2px; /**/
            right: 8px;
            cursor: pointer;
            font-size: 18px;
            font-weight: bold;
            color: #666;
            z-index: 10;                /* Sit above the drag handle */
            line-height: 1;
        `;

        // When the X is clicked, hide the popup (stopPropagation prevents other handlers)
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hidePopup();
        });

        // ---------- 3. Content wrapper (where explanation text appears) ----------
        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = contentHTML;
        contentDiv.style.padding = '0px 12px';

        // ---------- Assemble the popup ----------
        popup.appendChild(dragHandle);
        popup.appendChild(closeBtn);    // absolute positioned, so it overlays the handle
        popup.appendChild(contentDiv);

        // Popup container base styling
        popup.style.cssText = `
            position: absolute;
            z-index: 99999;
            background: #fff;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 450px;
            font-size: 14px;
            line-height: 1.5;
            color: #333;
            min-width: 200px;
        `;

        // Position the popup directly below the selected text
        // We add window.scrollX/Y because getBoundingClientRect gives viewport coordinates,
        // but position:absolute works relative to the whole page.
        popup.style.left = (rect.left + window.scrollX) + 'px';
        popup.style.top  = (rect.bottom + window.scrollY + 5) + 'px';   // 5px gap
        // a pending problem: it scroll with the window, even in some elements(well it is so hard)

        // Attach the popup to the page
        document.body.appendChild(popup);
        popupElement = popup;

        // ---------- Enable drag functionality ----------
        enableDragOnPopup(popup, dragHandle);
    }

    // ---------- This function makes a popup draggable by its handle ----------
    function enableDragOnPopup(popup, handleElement) {
        // When the user presses the mouse button on the drag handle
        handleElement.addEventListener('mousedown', function (e) {
            // Don't start a drag if the user clicked the close button
            // (the close button's stopPropagation already handles that, but we check just in case)
            if (e.target === popup.querySelector('span')) return;

            e.preventDefault();          // prevent default text selection etc.

            isDragging = true;
            justDragged = false;         // reset the "just dragged" flag

            // Record the offset between the mouse pointer and the popup's top-left corner
            // We use pageX/pageY because those are page-relative (include scroll)
            // popup.style.left and .top are also page-relative (we added scrollX/Y earlier)
            const popupLeft = parseFloat(popup.style.left) || 0;
            const popupTop  = parseFloat(popup.style.top)  || 0;

            dragOffsetX = e.pageX - popupLeft;
            dragOffsetY = e.pageY - popupTop;

            // Change cursor to "grabbing" while we drag
            handleElement.style.cursor = 'grabbing';
            // Disable transitions for instant movement
            //popup.style.transition = 'none';
        });

        // Global mouse movement – attached to the whole document so we can track even outside the handle
        document.addEventListener('mousemove', function (e) {
            if (!isDragging || !popupElement) return;

            e.preventDefault();

            // Calculate the new position using the stored offset
            const newLeft = e.pageX - dragOffsetX;
            const newTop  = e.pageY - dragOffsetY;

            // Update the popup's position
            popupElement.style.left = newLeft + 'px';
            popupElement.style.top  = newTop + 'px';
        });

        // Global mouse release – stop dragging
        document.addEventListener('mouseup', function () {
            if (!isDragging) return;

            isDragging = false;

            // If we had a handle element, restore its cursor
            if (popupElement) {
                const handle = popupElement.querySelector('.explaner-drag-handle');// find in son and grandson and grandgrandson and so on
                if (handle) handle.style.cursor = 'grab';
                // Optionally re-enable smooth transitions for future animations
                // popupElement.style.transition = '';
            }

            // Set a flag so the next click won't accidentally close the popup
            //justDragged = true;

            // Clear the flag after a short delay (after the click event would have fired)
            setTimeout(() => {
                justDragged = false;
            }, 0);
        });
    }

    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {}, // which will be sent to the server.
                data: options.body || null, // if you are uploading data you will save your content in it.
                onload: (resp) => {// return when gets informations back
                    // Build a fake Response object so the caller can use .json(), .ok, etc.
                    //attention();
                    const fakeResponse = {
                        ok: resp.status >= 200 && resp.status < 300,
                        status: resp.status,
                        statusText: resp.statusText,
                        url: url,
                        json: () => Promise.resolve(JSON.parse(resp.responseText)),
                        text: () => Promise.resolve(resp.responseText),
                        // we ignore .blob() etc. because you don't need them
                    };
                    //fakeResponse.style.cssText = `
                    //all: initial;                       /* ← kills inherited styles */
                    //font-size: 14px;
                    //text-align: left;
                    //`;
                    resolve(fakeResponse);
                },
                onerror: (err) => reject(err),
            });
        });
    }

    // ---------- Fetch explanation: tries dictionary first, then translation ----------
    async function fetchExplanation(text) {// async function always returns a promise
        // 1) If the text looks like a single English word (only letters), try a dictionary.
        if (/^[a-zA-Z]+$/.test(text.toLowerCase())) {
            //attention();
            try {
                const response = await gmFetch(
                    `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(text)}`// encodes special character in it
                );
                if (response.ok) {
                    //attention();
                    let data = await response.json();
                    data = data.en;
                    if (Array.isArray(data) && data.length > 0) {
                        //attention('101');
                        //attention((data.length).toString);
                        return formatDictionaryEntry(text, data);
                    }
                }
            } catch (err) {
                console.warn('Dictionary fetch failed', err);
            }
        }

        // 2) Translation fallback (or if not a single English word)
        return await fetchTranslation(text);
    }

    function Ikun(html) {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        return tempDiv.textContent || tempDiv.innerText || "";
    }

    // ---------- Format a dictionary entry as nice HTML ----------
    function formatDictionaryEntry(word, entry) {
        let html = `<div class="Zyx"><div class="entry"><h2 class="word">${word}</h2><ul style="position:relative;margin: 0 0 6px 6px;padding:0 0 0 10px;">`;
//attention("yuanshen");
        //if (entry.en) entry = entry.en;
        let yuanshen = 4;
        for (let i = 0; i < Math.min(yuanshen, entry.length); i++) {
            //attention(i.toString());
            let falg = 0;
            if(entry[i].partOfSpeech) for(let j = 0; j < Zyx_PartOfSpeech.length; j++) if(entry[i].partOfSpeech.toLowerCase() == Zyx_PartOfSpeech[j]) {yuanshen++; falg = 1; break;}
            if(falg) continue;
            if (entry[i].partOfSpeech) html += `<li class="pos-name"> ${entry[i].partOfSpeech}</li>`;
            //if (entry[i].definitions) html += entry[i].definitions[0].definition;
            if (entry[i].definitions) {html += `<h3 class="definition">- ${Ikun(entry[i].definitions[0].definition).trim()}</h3>`;
                let yu = 0, yu1 = 0, yu2 = 0;
                while(yu < explanation_Show) {
            if (entry[i].definitions[0].parsedExamples && entry[i].definitions[0].parsedExamples.length > yu1) html += `<p class="explanation">${Ikun(entry[i].definitions[0].parsedExamples[yu1++].example).trim()}</p>`;
            else if(entry[i].definitions[0].examples && entry[i].definitions[0].examples.length > yu2) html += `<p class="explanation">${Ikun(entry[i].definitions[0].examples[yu2++]).trim()}</p>`;
                                       else yu = explanation_Show;yu++;}}
            //if (entry[i].definitions[0].parsedExamples) html += `<p class="explanation">${Ikun(entry[i].definitions[0].parsedExamples[0].example)}</p>`;
            //else if(entry[i].definitions[0].examples) html += `<p class="explanation">${Ikun(entry[i].definitions[0].examples[0])}</p>`;}
        }html += `</ul></div></div>`;
        if (yuanshen == entry.length + 4){html = ``; hidePopup();return ;}

        // Phonetic transcription if available
//        if (entry.senses) {
//            html += ` <span style="color:#888;">/${escapeHTML(entry.senses)}/</span>`;
//        }

        // Meanings: part of speech + definitions
//        if (entry.meanings && entry.meanings.length > 0) {
//            entry.meanings.forEach(meaning => {
//                html += `<p style="margin:8px 0 2px;font-weight:bold;color:#555;">${escapeHTML(meaning.partOfSpeech)}</p>`;
//                html += '<ul style="margin:0;padding-left:18px;">';
//                const defs = meaning.definitions.slice(0, 3);   // at most 3 definitions
//                defs.forEach(def => {
//                    html += `<li>${escapeHTML(def.definition)}</li>`;
//                    if (def.example) {
//                        html += ` <span style="color:#999;font-style:italic;">e.g. "${escapeHTML(def.example)}"</span>`;
//                    }
//                });
//                html += '</ul>';
//            });
//        } else {
//            html += '<p>No definitions found.</p>';
//        }
//
        html += '<p style="font-size:11px;color:#aaa;">Source: Wiktionary</p>';
        // attention: doesn't work when not in <div> of documents :(
        html += `<style>
        .Zyx{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 640px;
    //margin: 40px auto;
    padding: 0;
    line-height: 1.3;
  }

  /* wrapper for each word entry */
  .Zyx .entry {
    margin-bottom: 12px;
  }

  /* the word itself */
  .Zyx .word {
    font-size: 20px;
    font-weight: bold;
    margin: 0 0 8px 0;
  }

  /* each part-of-speech block
  .Zyx .pos {
    position: relative;
    margin: 0 0 6px 0;
    padding: 0 0 0 10px;
    //border-left: 3px solid #d0d0d0;
  }*/

  /* part of speech label — raised relative to the vertical line */
  .Zyx .pos-name {
    font-size: 16px;
    font-weight: normal;
    font-style: italic;
    color: #0a66c2;
    margin: 0 0 2px 0;
    position: relative;
    top: -2px;              /* lift the label up */
  }

  /* definition */
  .Zyx .definition {
    font-size: 14px;
    color: #555;
    font-weight: normal;
    margin: 5px 0 -5px 0;
  }

  /* explanation */
  .Zyx .explanation {
    font-size: 14px;
    font-weight: normal;
    color: #777;
    margin: -5px 0 0 0;
  }
</style>`;
        return html;
    }

    // ---------- Translate text using Google Translate's free endpoint ----------
    async function fetchTranslation(text) {

        const response = await gmFetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh&dt=t&q=${encodeURIComponent(text)}`);
        if (!response.ok) {
            throw new Error(`Translation request failed (${response.status})`);
        }
        const data = await response.json();

        let translatedText = '';
        let detectedSource = '';
        if (data && data[0]) {
            translatedText = data[0].map(part => part[0]).join('');
        }
        if (data && data[2]) {
            detectedSource = data[2];
        }
        if(detectedSource == "zh-CN"){hidePopup();html = 0;return ;}

        //let html = `<p><b>Original:</b> ${escapeHTML(text)}</p>`;
        let html = `<p style="margin:0px 0px 12px"><b>Google:</b> ${escapeHTML(translatedText)}</p>`;
        if (detectedSource) {
            html += `<p style="font-size:11px;color:#888;">Detected source language: ${escapeHTML(detectedSource)}</p>`;
        }
        //html += '<p style="font-size:11px;color:#aaa;">Translated by Google Translate</p>';
        return html;
    }

    // ---------- Called every time the user selects/deselects text ----------
    function handleSelectionChange() {
        // Cancel any previous 3-second timer and hide the current popup
        clearTimeout(selectionTimeout);
        //hidePopup();

        const selection = window.getSelection();
        const text = selection.toString().trim();
        // trim removes all the newline and space at the begin and the end;

        // If nothing is selected, stop
        if (!text) {
            pendingText = '';
            hidePopup();
            return;
        }

        // Remember what we are waiting to explan
        pendingText = text;

        // Start the 3-second countdown
        selectionTimeout = setTimeout(async () => {// async makes it excuted TIME later.
            // After 3 seconds, check if the SAME text is still selected
            const currentText = window.getSelection().toString().trim();
            if (currentText !== pendingText || currentText.length === 0) {
                hidePopup();
                return;   // the user changed or cleared the selection – do nothing
            }

            if (FLAG) return ;

            // Get the coordinates of the current selection for positioning
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;

            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
//It returns a DOMRect object with exact pixel values:
//.top – Distance from the top of the visible browser window (viewport) to the top of the selected text.
//.bottom – Distance from the top of the viewport to the bottom of the selected text.
//.left – Distance from the left edge of the viewport.
//.right – Distance from the left edge to the right edge of the text.
//.width / .height – The dimensions of the selection box.

            // Show a loading indicator at the correct position
            FLAG = 1;
            showPopup(rect, '<div style="margin:0px 0px 20px;">Loading...</div>');

            try {
                const explanationHTML = await fetchExplanation(currentText);
                // Only update if the popup still exists and the selection hasn't changed
                if (popupElement && window.getSelection().toString().trim() === pendingText) {
                    // The content div is the last child (after dragHandle and closeBtn)
                    const contentDiv = popupElement.querySelector('div:last-child');
                    if (contentDiv) contentDiv.innerHTML = explanationHTML;
                } else {
                    hidePopup();
                }
            } catch (err) {
                console.error('Explanation error:', err);
                if (popupElement) {
                    const contentDiv = popupElement.querySelector('div:last-child');
                    hidePopup();
                    if (contentDiv) contentDiv.innerHTML = '<p>Fail to fetch explanation.</p>';
                }
            }
        }, TIME);   // 3000 milliseconds = 3 seconds
    }

    // ---------- Listen for text selections (mouse and keyboard) ----------
    document.addEventListener('mouseup', handleSelectionChange);
    document.addEventListener('keyup', handleSelectionChange);

    // ---------- Clicking anywhere outside the popup hides it ----------
    document.addEventListener('click', function (e) {
        // If the user just finished dragging, don't hide the popup
        if (justDragged) {
            justDragged = false;  // consume the flag
            return;
        }
        // If the click is outside the popup, close it
        if (popupElement && !popupElement.contains(e.target)) {
            hidePopup();
        }
    });

    // ---------- Pressing Escape also closes the popup ----------
    document.addEventListener('keydown', function (e) {
        //if (e.key === 'Escape') {
            //hidePopup();
        //}
    });

})();
