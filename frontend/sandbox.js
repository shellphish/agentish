/**
 * Agentish Sandbox Frontend
 * Handles bundle upload, execution, and result display
 */

(function() {
    'use strict';

    // DOM Elements
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const filenameDisplay = document.getElementById('filename');
    const executeBtn = document.getElementById('execute-btn');
    const clearBtn = document.getElementById('clear-btn');
    const statusValue = document.getElementById('status-value');
    const compileStatus = document.getElementById('compile-status');
    const compileValue = document.getElementById('compile-value');
    const syntaxStatus = document.getElementById('syntax-status');
    const syntaxValue = document.getElementById('syntax-value');
    const executionStatus = document.getElementById('execution-status');
    const executionValue = document.getElementById('execution-value');
    const downloadSection = document.getElementById('download-section');
    const downloadCodeBtn = document.getElementById('download-code-btn');
    const downloadStateBtn = document.getElementById('download-state-btn');
    const downloadLogsBtn = document.getElementById('download-logs-btn');
    const logOutput = document.getElementById('log-output');

    // State
    let selectedFile = null;
    let currentJobId = null;
    let pollInterval = null;

    // Toast notification
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Update status display
    function setStatus(element, text, className) {
        element.textContent = text;
        element.className = 'value ' + className;
    }

    // Reset UI to initial state
    function resetUI() {
        selectedFile = null;
        currentJobId = null;
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        uploadZone.classList.remove('has-file');
        filenameDisplay.classList.add('hidden');
        filenameDisplay.textContent = '';
        fileInput.value = '';

        executeBtn.disabled = true;
        clearBtn.disabled = true;

        setStatus(statusValue, 'No bundle loaded', 'pending');

        compileStatus.classList.add('hidden');
        syntaxStatus.classList.add('hidden');
        executionStatus.classList.add('hidden');
        downloadSection.classList.add('hidden');

        logOutput.innerHTML = '<span class="info">Upload a bundle and click Execute to see output here...</span>';
    }

    // Handle file selection
    function handleFileSelect(file) {
        if (!file) return;

        if (!file.name.endsWith('.zip')) {
            showToast('Please select a .zip file', 'error');
            return;
        }

        selectedFile = file;
        uploadZone.classList.add('has-file');
        filenameDisplay.textContent = file.name;
        filenameDisplay.classList.remove('hidden');
        executeBtn.disabled = false;
        clearBtn.disabled = false;
        setStatus(statusValue, 'Bundle loaded - ready to execute', 'pending');

        // Reset status cards
        compileStatus.classList.add('hidden');
        syntaxStatus.classList.add('hidden');
        executionStatus.classList.add('hidden');
        downloadSection.classList.add('hidden');

        showToast(`Bundle "${file.name}" loaded`, 'success');
    }

    // Upload zone click handler
    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });

    // File input change handler
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    // Drag and drop handlers
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    // Clear button handler
    clearBtn.addEventListener('click', resetUI);

    // Execute button handler
    executeBtn.addEventListener('click', async () => {
        if (!selectedFile) {
            showToast('Please select a bundle first', 'error');
            return;
        }

        // Disable buttons during execution
        executeBtn.disabled = true;
        executeBtn.innerHTML = '<span class="spinner"></span>Uploading...';

        // Show status cards
        compileStatus.classList.remove('hidden');
        syntaxStatus.classList.remove('hidden');
        executionStatus.classList.remove('hidden');

        setStatus(statusValue, 'Uploading bundle...', 'running');
        setStatus(compileValue, 'Waiting...', 'pending');
        setStatus(syntaxValue, 'Waiting...', 'pending');
        setStatus(executionValue, 'Waiting...', 'pending');

        logOutput.innerHTML = '<span class="info">Starting execution...</span>\n';

        try {
            // Upload the bundle
            const formData = new FormData();
            formData.append('bundle', selectedFile);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Upload failed: HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Upload failed');
            }

            currentJobId = data.job_id;
            setStatus(statusValue, 'Executing...', 'running');
            executeBtn.innerHTML = '<span class="spinner"></span>Executing...';

            // Start polling for status
            pollStatus();
            pollInterval = setInterval(pollStatus, 2000);

        } catch (err) {
            setStatus(statusValue, `Error: ${err.message}`, 'error');
            executeBtn.disabled = false;
            executeBtn.innerHTML = 'Execute Agent';
            showToast(err.message, 'error');
            logOutput.innerHTML += `<span class="stderr">Error: ${err.message}</span>\n`;
        }
    });

    // Poll for job status
    async function pollStatus() {
        if (!currentJobId) return;

        try {
            const response = await fetch(`/api/status/${currentJobId}`);
            if (!response.ok) {
                throw new Error(`Status check failed: HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Status check failed');
            }

            const job = data.job;
            updateUIFromJob(job);

            // Stop polling if job is complete
            if (job.status === 'success' || job.status === 'error') {
                if (pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                }
                executeBtn.disabled = false;
                executeBtn.innerHTML = 'Execute Agent';

                if (job.status === 'success') {
                    downloadSection.classList.remove('hidden');
                    showToast('Execution completed successfully!', 'success');
                } else {
                    showToast('Execution failed', 'error');
                }
            }

        } catch (err) {
            console.warn('Poll error:', err);
        }
    }

    // Update UI from job data
    function updateUIFromJob(job) {
        // Main status
        if (job.status === 'running') {
            setStatus(statusValue, 'Executing...', 'running');
        } else if (job.status === 'success') {
            setStatus(statusValue, 'Completed successfully', 'success');
        } else if (job.status === 'error') {
            setStatus(statusValue, `Error: ${job.error || 'Unknown error'}`, 'error');
        }

        // Compile status
        if (job.compile) {
            if (job.compile.status === 'in_progress') {
                setStatus(compileValue, 'Compiling...', 'running');
            } else if (job.compile.status === 'success') {
                setStatus(compileValue, job.compile.details || 'Completed', 'success');
            } else if (job.compile.status === 'error') {
                setStatus(compileValue, job.compile.details || 'Failed', 'error');
            }
        }

        // Syntax status
        if (job.syntax) {
            if (job.syntax.status === 'in_progress') {
                setStatus(syntaxValue, 'Checking...', 'running');
            } else if (job.syntax.status === 'success') {
                setStatus(syntaxValue, job.syntax.details || 'Valid', 'success');
            } else if (job.syntax.status === 'error') {
                setStatus(syntaxValue, job.syntax.details || 'Invalid', 'error');
            }
        }

        // Execution status
        if (job.execution) {
            if (job.execution.status === 'in_progress') {
                setStatus(executionValue, 'Running...', 'running');
            } else if (job.execution.status === 'success') {
                setStatus(executionValue, job.execution.details || 'Completed', 'success');
            } else if (job.execution.status === 'error') {
                setStatus(executionValue, job.execution.details || 'Failed', 'error');
            }

            // Update logs
            updateLogs(job.execution);
        }
    }

    // Update log output
    function updateLogs(execution) {
        let logContent = '';

        if (execution.stdout) {
            // Filter out the final state markers from display
            let stdout = execution.stdout;
            if (stdout.includes('===FINAL_STATE_START===')) {
                stdout = stdout.split('===FINAL_STATE_START===')[0];
            }
            if (stdout.trim()) {
                logContent += `<span class="stdout">${escapeHtml(stdout)}</span>`;
            }
        }

        if (execution.stderr && execution.stderr.trim()) {
            logContent += `\n<span class="stderr">=== STDERR ===\n${escapeHtml(execution.stderr)}</span>`;
        }

        if (execution.final_state) {
            logContent += `\n\n<span class="info">=== FINAL STATE ===\n${escapeHtml(JSON.stringify(execution.final_state, null, 2))}</span>`;
        }

        if (logContent) {
            logOutput.innerHTML = logContent;
        }
    }

    // Escape HTML for safe display
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Download handlers
    downloadCodeBtn.addEventListener('click', async () => {
        if (!currentJobId) return;
        window.location.href = `/api/download/${currentJobId}/code`;
    });

    downloadStateBtn.addEventListener('click', async () => {
        if (!currentJobId) return;
        window.location.href = `/api/download/${currentJobId}/state`;
    });

    downloadLogsBtn.addEventListener('click', async () => {
        if (!currentJobId) return;
        window.location.href = `/api/download/${currentJobId}/logs`;
    });

    // Initialize
    resetUI();

})();
