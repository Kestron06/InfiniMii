function switchTab(tab) {
    // Update buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');
}

// Studio code preview
document.getElementById('studioCode').addEventListener('input', function(e) {
    let code = e.target.value.trim();
    
    // Extract code from URL if pasted
    if (code.includes('studio.mii.nintendo.com')) {
        const match = code.match(/data=([0-9a-fA-F]+)/);
        if (match) {
            code = match[1];
            e.target.value = code;
        }
    }
    
    // Show preview if valid hex code
    if (/^[0-9a-fA-F]+$/.test(code) && code.length >= 88) {
        document.getElementById('studioPreviewImg').src = 
            `https://studio.mii.nintendo.com/miis/image.png?data=${code}&type=face&width=512&instanceCount=1`;
        document.getElementById('studioPreview').classList.add('active');
    }
    else {
        document.getElementById('studioPreview').classList.remove('active');
    }
});