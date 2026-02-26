const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

function initDarkMode() {
    browserAPI.storage.sync.get({ darkMode: 'system' }, ({ darkMode }) => {
        const html = document.documentElement;
        if (darkMode === 'dark') {
            html.classList.add('dark');
        } else if (darkMode === 'light') {
            html.classList.remove('dark');
        } else {
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                html.classList.add('dark');
            } else {
                html.classList.remove('dark');
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', async function() {
    initDarkMode();

    const statusElement = document.getElementById('status');
    const optionsButton = document.getElementById('optionsButton');

    try {
        // Use async/await and proper error handling
        const result = await new Promise((resolve) => {
            browserAPI.storage.sync.get({
                llmProvider: 'openai', // default value
                apiKey: ''
            }, resolve);
        });

        if (result.apiKey) {
            statusElement.textContent = `Extension is ready to use with ${result.llmProvider} provider.`;
            statusElement.className = 'mb-3 p-3 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 rounded-lg text-sm';
        } else {
            statusElement.textContent = 'API key not set. Please set it in the options.';
            statusElement.className = 'mb-3 p-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 rounded-lg text-sm';
        }
    } catch (error) {
        console.error('Error checking storage:', error);
        statusElement.textContent = 'Error checking extension status.';
        statusElement.className = 'mb-3 p-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 rounded-lg text-sm';
    }

    // Open options page when button is clicked
    optionsButton.addEventListener('click', function() {
        try {
            if (browserAPI.runtime.openOptionsPage) {
                // Chrome & Firefox support
                browserAPI.runtime.openOptionsPage();
            } else {
                // Fallback for older Firefox versions
                window.open(browserAPI.runtime.getURL('options.html'));
            }
        } catch (error) {
            console.error('Error opening options page:', error);
            // Fallback method
            window.open(browserAPI.runtime.getURL('options.html'));
        }
    });
});