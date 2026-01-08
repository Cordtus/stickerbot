// configurator.js

import os from 'os';
import { execSync } from 'child_process';

// Cache system spec
let cachedSystemSpec = null;

// Enhanced logger
function logWithContext(context, message, error = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${context}] ${message}`);
    if (error) {
        console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

/**
 * Detect system architecture and capabilities
 */
function detectSystem() {
    const platform = os.platform();
    const arch = os.arch();
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    
    const system = {
        platform,
        arch,
        cpuCount: cpus.length,
        cpuModel: cpus[0]?.model || 'Unknown',
        totalMemory: totalMem,
        totalMemoryGB: Math.round(totalMem / 1024 / 1024 / 1024),
        isRaspberryPi: false,
        isARM: arch.includes('arm'),
        isX64: arch === 'x64',
        isLXC: false,
        piModel: null
    };
    
    // Detect Raspberry Pi
    try {
        if (platform === 'linux') {
            const cpuInfo = execSync('cat /proc/cpuinfo 2>/dev/null || echo "unknown"', { encoding: 'utf8' });
            system.isRaspberryPi = cpuInfo.includes('Raspberry Pi') || cpuInfo.includes('BCM');
            
            if (system.isRaspberryPi) {
                // Detect Pi model
                const model = cpuInfo.match(/Model\s+:\s+(.+)/)?.[1] || 'Unknown Pi';
                system.piModel = model;
                logWithContext('systemDetector', `Detected Raspberry Pi: ${model}`);
            }

            // Detect LXC/Docker container
            try {
                const cgroupInfo = execSync('cat /proc/1/cgroup 2>/dev/null || echo "unknown"', { encoding: 'utf8' });
                system.isLXC = cgroupInfo.includes('docker') || cgroupInfo.includes('lxc');
            } catch (err) {
                // Ignore errors
            }
        }
    } catch (err) {
        // Ignore errors, just won't detect Pi specifically
    }
    
    return system;
}

/**
 * Enhanced FFmpeg detection with detailed capability checking
 */
function detectFFmpeg() {
    const results = {
        available: false,
        version: null,
        codecs: {},
        encoders: {},
        hwaccels: {},
        filters: {},
        error: null
    };
    
    try {
        // Test basic FFmpeg availability
        logWithContext('systemDetector', 'Testing FFmpeg availability...');
        const versionOutput = execSync('ffmpeg -version 2>&1', { 
            encoding: 'utf8',
            timeout: 5000 
        });
        
        results.available = true;
        
        // Extract version
        const versionMatch = versionOutput.match(/ffmpeg version ([^\s]+)/);
        if (versionMatch) {
            results.version = versionMatch[1];
            logWithContext('systemDetector', `FFmpeg version: ${results.version}`);
        }
        
        // Check for specific encoders
        try {
            const encodersOutput = execSync('ffmpeg -encoders 2>&1', { 
                encoding: 'utf8',
                timeout: 5000 
            });
            
            results.encoders = {
                libx264: encodersOutput.includes('libx264'),
                libvpx: encodersOutput.includes('libvpx'),
                libvpx_vp9: encodersOutput.includes('libvpx-vp9'),
                h264_nvenc: encodersOutput.includes('h264_nvenc'),
                h264_v4l2m2m: encodersOutput.includes('h264_v4l2m2m'),
                h264_vaapi: encodersOutput.includes('h264_vaapi')
            };
            
            logWithContext('systemDetector', `Available encoders: ${Object.entries(results.encoders).filter(([k,v]) => v).map(([k]) => k).join(', ')}`);
        } catch (err) {
            logWithContext('systemDetector', 'Could not check encoders', err);
        }
        
        // Check hardware acceleration
        try {
            const hwaccelsOutput = execSync('ffmpeg -hwaccels 2>&1', { 
                encoding: 'utf8',
                timeout: 5000 
            });
            
            results.hwaccels = {
                cuda: hwaccelsOutput.includes('cuda'),
                nvdec: hwaccelsOutput.includes('nvdec'),
                vaapi: hwaccelsOutput.includes('vaapi'),
                v4l2m2m: hwaccelsOutput.includes('v4l2m2m'),
                drm: hwaccelsOutput.includes('drm')
            };
            
            logWithContext('systemDetector', `Available hwaccels: ${Object.entries(results.hwaccels).filter(([k,v]) => v).map(([k]) => k).join(', ')}`);
        } catch (err) {
            logWithContext('systemDetector', 'Could not check hardware acceleration', err);
        }
        
    } catch (err) {
        results.error = err.message;
        logWithContext('systemDetector', 'FFmpeg not available or failed to execute', err);
    }
    
    return results;
}

/**
 * Test hardware acceleration capabilities safely
 */
async function testHardwareAcceleration(ffmpegInfo, systemInfo) {
    const capabilities = {
        nvidia: false,
        vaapi: false,
        v4l2m2m: false,
        cpu: true,
        error: null
    };
    
    if (!ffmpegInfo.available) {
        capabilities.error = 'FFmpeg not available';
        return capabilities;
    }
    
    // Test NVIDIA GPU acceleration (for x64 systems)
    if (systemInfo.isX64 && ffmpegInfo.encoders.h264_nvenc) {
        try {
            logWithContext('systemDetector', 'Testing NVIDIA GPU acceleration...');
            execSync('ffmpeg -f lavfi -i testsrc=duration=0.1:size=64x64:rate=1 -c:v h264_nvenc -f null - 2>/dev/null', {
                timeout: 10000
            });
            capabilities.nvidia = true;
            logWithContext('systemDetector', 'NVIDIA GPU acceleration available');
        } catch (err) {
            logWithContext('systemDetector', 'NVIDIA GPU acceleration not available');
        }
    }
    
    // Test VAAPI (Intel hardware acceleration)
    if (ffmpegInfo.hwaccels.vaapi && ffmpegInfo.encoders.h264_vaapi) {
        try {
            logWithContext('systemDetector', 'Testing VAAPI acceleration...');
            execSync('ffmpeg -f lavfi -i testsrc=duration=0.1:size=64x64:rate=1 -vaapi_device /dev/dri/renderD128 -vf "format=nv12,hwupload" -c:v h264_vaapi -f null - 2>/dev/null', {
                timeout: 10000
            });
            capabilities.vaapi = true;
            logWithContext('systemDetector', 'VAAPI acceleration available');
        } catch (err) {
            logWithContext('systemDetector', 'VAAPI acceleration not available');
        }
    }
    
    // Test V4L2 M2M (Raspberry Pi hardware acceleration)
    if (systemInfo.isRaspberryPi && ffmpegInfo.encoders.h264_v4l2m2m) {
        try {
            logWithContext('systemDetector', 'Testing Raspberry Pi hardware acceleration...');
            execSync('ffmpeg -f lavfi -i testsrc=duration=0.1:size=64x64:rate=1 -c:v h264_v4l2m2m -f null - 2>/dev/null', {
                timeout: 10000
            });
            capabilities.v4l2m2m = true;
            logWithContext('systemDetector', 'Raspberry Pi hardware acceleration available');
        } catch (err) {
            logWithContext('systemDetector', 'Raspberry Pi hardware acceleration not available');
        }
    }
    
    return capabilities;
}

/**
 * Get optimized FFmpeg settings for the detected system
 */
function getOptimizedSettings(systemInfo, ffmpegInfo, hwCapabilities) {
    const settings = {
        preferredEncoder: 'libx264',
        hardwareAcceleration: false,
        cpuThreads: Math.min(systemInfo.cpuCount, 4),
        preset: 'medium',
        crf: 28,
        additionalOptions: [],
        inputOptions: [],
        outputOptions: []
    };
    
    // Raspberry Pi optimizations
    if (systemInfo.isRaspberryPi) {
        settings.preset = 'ultrafast';
        settings.crf = 32; // Higher compression for limited CPU
        settings.cpuThreads = Math.min(systemInfo.cpuCount, 2);
        
        if (hwCapabilities.v4l2m2m) {
            settings.preferredEncoder = 'h264_v4l2m2m';
            settings.hardwareAcceleration = true;
            settings.additionalOptions = [
                '-pix_fmt yuv420p',
                '-b:v 500k',
                '-maxrate 1000k',
                '-bufsize 2000k'
            ];
        } else {
            // CPU-only optimizations for Pi
            settings.additionalOptions = [
                '-pix_fmt yuv420p',
                '-x264-params keyint=15:no-scenecut',
                '-b:v 300k',
                '-maxrate 600k',
                '-bufsize 1200k'
            ];
        }
    }
    // x64 with NVIDIA GPU
    else if (systemInfo.isX64 && hwCapabilities.nvidia) {
        settings.preferredEncoder = 'h264_nvenc';
        settings.hardwareAcceleration = true;
        settings.inputOptions = ['-hwaccel cuda', '-hwaccel_output_format cuda'];
        settings.additionalOptions = [
            '-preset fast',
            '-profile:v high',
            '-level 4.1',
            '-pix_fmt yuv420p',
            '-rc vbr',
            '-cq 25',
            '-b:v 800k',
            '-maxrate 1600k',
            '-bufsize 3200k'
        ];
    }
    // x64 with Intel VAAPI
    else if (systemInfo.isX64 && hwCapabilities.vaapi) {
        settings.preferredEncoder = 'h264_vaapi';
        settings.hardwareAcceleration = true;
        settings.inputOptions = ['-vaapi_device /dev/dri/renderD128'];
        settings.additionalOptions = [
            '-vf format=nv12,hwupload',
            '-profile:v high',
            '-level 4.1',
            '-b:v 600k',
            '-maxrate 1200k',
            '-bufsize 2400k'
        ];
    }
    // CPU fallback
    else {
        if (systemInfo.isARM) {
            // ARM CPU optimizations
            settings.preset = 'faster';
            settings.crf = 30;
            settings.additionalOptions = [
                '-pix_fmt yuv420p',
                '-x264-params keyint=30:no-scenecut',
                '-b:v 400k',
                '-maxrate 800k',
                '-bufsize 1600k'
            ];
        } else {
            // x64 CPU optimizations
            settings.preset = 'medium';
            settings.crf = 26;
            settings.additionalOptions = [
                '-pix_fmt yuv420p',
                '-b:v 600k',
                '-maxrate 1200k',
                '-bufsize 2400k'
            ];
        }
    }
    
    return settings;
}

/**
 * Complete system detection and optimization
 */
async function detectAndOptimize() {
    logWithContext('systemDetector', 'Starting system detection...');
    
    const systemInfo = detectSystem();
    const ffmpegInfo = detectFFmpeg();
    
    logWithContext('systemDetector', `System: ${systemInfo.platform} ${systemInfo.arch}, ${systemInfo.cpuCount} CPUs, ${systemInfo.totalMemoryGB}GB RAM`);
    
    if (systemInfo.isRaspberryPi) {
        logWithContext('systemDetector', `Raspberry Pi detected: ${systemInfo.piModel}`);
    }
    
    let hwCapabilities = { nvidia: false, vaapi: false, v4l2m2m: false, cpu: true };
    
    if (ffmpegInfo.available) {
        logWithContext('systemDetector', `FFmpeg ${ffmpegInfo.version} available`);
        hwCapabilities = await testHardwareAcceleration(ffmpegInfo, systemInfo);
    } else {
        logWithContext('systemDetector', 'FFmpeg not available - video processing disabled');
    }
    
    const optimizedSettings = getOptimizedSettings(systemInfo, ffmpegInfo, hwCapabilities);
    
    const result = {
        system: systemInfo,
        ffmpeg: ffmpegInfo,
        hardware: hwCapabilities,
        settings: optimizedSettings,
        summary: {
            platform: `${systemInfo.platform} ${systemInfo.arch}`,
            ffmpegAvailable: ffmpegInfo.available,
            hardwareAcceleration: optimizedSettings.hardwareAcceleration,
            preferredEncoder: optimizedSettings.preferredEncoder,
            optimizedFor: systemInfo.isRaspberryPi ? 'Raspberry Pi' : 
                         systemInfo.isARM ? 'ARM CPU' : 
                         hwCapabilities.nvidia ? 'NVIDIA GPU' :
                         hwCapabilities.vaapi ? 'Intel GPU' : 'CPU'
        }
    };
    
    logWithContext('systemDetector', `Optimization: ${result.summary.optimizedFor} (${result.summary.preferredEncoder})`);
    
    return result;
}

/**
 * Get system spec (with caching)
 */
async function getSystemSpec() {
    if (!cachedSystemSpec) {
        logWithContext('systemSpec', 'Detecting system specs (first time)...');
        cachedSystemSpec = await detectAndOptimize();
        logWithContext('systemSpec', `System specs cached: ${cachedSystemSpec.summary.optimizedFor}`);
    }
    return cachedSystemSpec;
}

export {
    detectSystem,
    detectFFmpeg,
    getSystemSpec,
    testHardwareAcceleration,
    getOptimizedSettings,
    detectAndOptimize
};