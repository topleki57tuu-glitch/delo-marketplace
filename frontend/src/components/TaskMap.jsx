// Карта заданий на Яндекс Картах: метки с кластеризацией, «рядом со мной»
// с фильтром по радиусу, фильтр по категориям и карточка выбранного задания.
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { IconWarning } from './icons.jsx';
import { useToast } from './Toast.jsx';
import MapControls from './taskMap/MapControls.jsx';
import TaskPreviewCard from './taskMap/TaskPreviewCard.jsx';
import { YMAPS_URL, MOSCOW_CENTER, CATEGORY_ICONS, calculateDistance } from './taskMap/taskMapConfig.js';

export const TaskMap = ({
    tasks = [],
    onTaskClick,
    selectedTaskId = null,
    className = "",
    height = "100%",
    userRole = "specialist"
}) => {
    const { addToast } = useToast();
    const mapContainerRef = useRef(null);
    const mapInstance = useRef(null);
    const clustererRef = useRef(null);
    const userPlacemarkRef = useRef(null);
    const accuracyCircleRef = useRef(null);

    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState(null);
    const [userLocation, setUserLocation] = useState(null);
    const [geoLocating, setGeoLocating] = useState(false);
    const [selectedRadius, setSelectedRadius] = useState(0); // 0 = all
    const [activeCategory, setActiveCategory] = useState('');
    const [activePreviewTask, setActivePreviewTask] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Filter tasks with location
    const tasksWithLocation = useMemo(() => {
        return tasks.filter(t => t.latitude && t.longitude && !t.is_remote);
    }, [tasks]);

    // Apply radius and category filters
    const filteredTasks = useMemo(() => {
        return tasksWithLocation.filter(task => {
            if (activeCategory && task.category !== activeCategory) {
                return false;
            }
            if (selectedRadius > 0 && userLocation) {
                const dist = calculateDistance(
                    userLocation[0],
                    userLocation[1],
                    task.latitude,
                    task.longitude
                );
                if (dist !== null && dist > selectedRadius) {
                    return false;
                }
            }
            return true;
        });
    }, [tasksWithLocation, activeCategory, selectedRadius, userLocation]);

    // Categories present in the current tasks
    const availableCategories = useMemo(() => {
        const set = new Set();
        tasksWithLocation.forEach(t => {
            if (t.category) set.add(t.category);
        });
        return Array.from(set);
    }, [tasksWithLocation]);

    // Load Yandex Maps API
    useEffect(() => {
        let isMounted = true;

        const loadScript = () => {
            if (window.ymaps) {
                window.ymaps.ready(() => {
                    if (isMounted) initMap();
                });
                return;
            }

            const existingScript = document.getElementById('ymaps-script');
            if (existingScript) {
                existingScript.addEventListener('load', () => {
                    if (window.ymaps) {
                        window.ymaps.ready(() => {
                            if (isMounted) initMap();
                        });
                    }
                });
                return;
            }

            const script = document.createElement('script');
            script.id = 'ymaps-script';
            script.src = YMAPS_URL;
            script.async = true;
            script.onload = () => {
                if (window.ymaps) {
                    window.ymaps.ready(() => {
                        if (isMounted) initMap();
                    });
                }
            };
            script.onerror = () => {
                if (isMounted) {
                    setMapError('Не удалось загрузить картографический сервис. Проверьте интернет-соединение.');
                }
            };
            document.head.appendChild(script);
        };

        loadScript();

        return () => {
            isMounted = false;
            if (mapInstance.current) {
                mapInstance.current.destroy();
                mapInstance.current = null;
            }
        };
    }, []);

    const initMap = () => {
        if (!mapContainerRef.current || mapInstance.current || !window.ymaps) return;

        try {
            const map = new window.ymaps.Map(mapContainerRef.current, {
                center: MOSCOW_CENTER,
                zoom: 11,
                controls: ['zoomControl', 'typeSelector']
            }, {
                searchControlProvider: 'yandex#search',
                suppressMapOpenBlock: true
            });

            // Mobile-friendly behaviors
            map.behaviors.enable(['drag', 'dblClickZoom', 'multiTouch']);

            // Create clusterer with dark styling
            const clusterer = new window.ymaps.Clusterer({
                preset: 'islands#invertedNightClusterIcons',
                groupByCoordinates: false,
                clusterDisableClickZoom: false,
                clusterHideIconOnBalloonOpen: false,
                geoObjectHideIconOnBalloonOpen: false
            });

            map.geoObjects.add(clusterer);
            mapInstance.current = map;
            clustererRef.current = clusterer;
            setMapReady(true);
        } catch (err) {
            console.error("Yandex Map init error:", err);
            setMapError('Ошибка инициализации карты');
        }
    };

    // Geolocation handler
    const locateUser = useCallback(() => {
        if (!navigator.geolocation) {
            addToast('Геолокация не поддерживается вашим устройством', 'error');
            return;
        }

        setGeoLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const coords = [pos.coords.latitude, pos.coords.longitude];
                setUserLocation(coords);
                setGeoLocating(false);

                if (mapInstance.current && window.ymaps) {
                    // Update user marker
                    if (userPlacemarkRef.current) {
                        mapInstance.current.geoObjects.remove(userPlacemarkRef.current);
                    }
                    if (accuracyCircleRef.current) {
                        mapInstance.current.geoObjects.remove(accuracyCircleRef.current);
                    }

                    // Accuracy circle
                    const circle = new window.ymaps.Circle(
                        [coords, pos.coords.accuracy || 200],
                        {},
                        {
                            fillColor: 'rgba(124, 108, 255, 0.15)',
                            strokeColor: '#7C6CFF',
                            strokeOpacity: 0.6,
                            strokeWidth: 1.5
                        }
                    );
                    accuracyCircleRef.current = circle;
                    mapInstance.current.geoObjects.add(circle);

                    // User Pin
                    const userPin = new window.ymaps.Placemark(
                        coords,
                        { hintContent: 'Вы находитесь здесь' },
                        {
                            preset: 'islands#nightCircleDotIconWithCaption',
                            iconCaption: 'Вы здесь'
                        }
                    );
                    userPlacemarkRef.current = userPin;
                    mapInstance.current.geoObjects.add(userPin);

                    mapInstance.current.setCenter(coords, 13, {
                        checkZoomRange: true,
                        duration: 500
                    });
                }
            },
            (err) => {
                console.warn("Geolocation error:", err);
                setGeoLocating(false);
                addToast('Не удалось определить местоположение. Проверьте разрешения в браузере.', 'error');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    }, [addToast]);

    // Center all markers
    const fitAllMarkers = useCallback(() => {
        if (!mapInstance.current || !clustererRef.current) return;
        const bounds = clustererRef.current.getBounds();
        if (bounds) {
            mapInstance.current.setBounds(bounds, {
                checkZoomRange: true,
                zoomMargin: [60, 60, 60, 60],
                duration: 400
            });
        }
    }, []);

    // Update placemarks on tasks or filter changes
    useEffect(() => {
        if (!mapReady || !clustererRef.current || !window.ymaps) return;

        clustererRef.current.removeAll();

        const placemarks = filteredTasks.map(task => {
            const isSelected = task.id === selectedTaskId;
            const emoji = CATEGORY_ICONS[task.category] || '📌';
            const priceText = task.budget ? `${Number(task.budget).toLocaleString('ru-RU')} ₽` : 'Договорная';
            const distance = userLocation
                ? calculateDistance(userLocation[0], userLocation[1], task.latitude, task.longitude)
                : null;

            const placemark = new window.ymaps.Placemark(
                [task.latitude, task.longitude],
                {
                    taskId: task.id,
                    hintContent: `${emoji} ${task.title} — ${priceText}`,
                    balloonContent: '' // We use rich bottom preview card for mobile/desktop
                },
                {
                    preset: isSelected
                        ? 'islands#nightShoppingIcon'
                        : task.status === 'open'
                            ? 'islands#violetShoppingIcon'
                            : 'islands#greyShoppingIcon',
                    iconColor: isSelected ? '#34D399' : '#7C6CFF'
                }
            );

            placemark.events.add('click', () => {
                setActivePreviewTask(task);
                if (mapInstance.current) {
                    mapInstance.current.setCenter([task.latitude, task.longitude], Math.max(mapInstance.current.getZoom(), 14), {
                        duration: 300
                    });
                }
            });

            return placemark;
        });

        clustererRef.current.add(placemarks);

        // Auto-fit if filtered tasks changed and not manually selecting
        if (placemarks.length > 0 && !selectedTaskId && !userLocation) {
            const bounds = clustererRef.current.getBounds();
            if (bounds) {
                mapInstance.current.setBounds(bounds, {
                    checkZoomRange: true,
                    zoomMargin: 60
                });
            }
        }
    }, [filteredTasks, mapReady, selectedTaskId, userLocation]);

    // Selected task sync
    useEffect(() => {
        if (selectedTaskId && tasks.length > 0) {
            const task = tasks.find(t => t.id === selectedTaskId);
            if (task && task.latitude && task.longitude) {
                setActivePreviewTask(task);
                if (mapInstance.current) {
                    mapInstance.current.setCenter([task.latitude, task.longitude], 15, {
                        duration: 400
                    });
                }
            }
        }
    }, [selectedTaskId, tasks]);

    return (
        <div className={`relative w-full overflow-hidden rounded-2xl border border-border bg-surface ${isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none h-screen' : ''} ${className}`} style={{ height: isFullscreen ? '100vh' : height }}>
            {/* Map container */}
            <div ref={mapContainerRef} className="w-full h-full" />

            {/* Error Overlay */}
            {mapError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/95 p-6 text-center z-20">
                    <div className="text-4xl mb-3"><IconWarning /></div>
                    <p className="font-bold text-ink text-base">{mapError}</p>
                    <button
                        onClick={() => { setMapError(null); initMap(); }}
                        className="mt-4 px-4 py-2 bg-accent hover:bg-accent-bright text-white rounded-xl text-xs font-bold uppercase tracking-wider transition"
                    >
                        Повторить
                    </button>
                </div>
            )}

            {/* Loading Indicator */}
            {!mapReady && !mapError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/80 backdrop-blur-sm z-10">
                    <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-3"></div>
                    <p className="text-sm font-semibold text-muted">Загрузка интерактивной карты...</p>
                </div>
            )}

            {/* Top Overlay Controls Bar */}
            <MapControls
                locateUser={locateUser}
                geoLocating={geoLocating}
                userLocation={userLocation}
                fitAllMarkers={fitAllMarkers}
                filteredTasks={filteredTasks}
                tasksWithLocation={tasksWithLocation}
                isFullscreen={isFullscreen}
                setIsFullscreen={setIsFullscreen}
                selectedRadius={selectedRadius}
                setSelectedRadius={setSelectedRadius}
                availableCategories={availableCategories}
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
            />

            {/* Bottom Floating Task Preview Card / Bottom Sheet */}
            {activePreviewTask && (
                <TaskPreviewCard
                    activePreviewTask={activePreviewTask}
                    userLocation={userLocation}
                    userRole={userRole}
                    onTaskClick={onTaskClick}
                    onClose={() => setActivePreviewTask(null)}
                />
            )}
        </div>
    );
};
