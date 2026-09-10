import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';

const YANDEX_API_KEY = import.meta.env.VITE_YANDEX_MAPS_API_KEY || '';
const MOSCOW_CENTER = [55.751574, 37.573856];

// Haversine formula to calculate distance in km
export function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    return d < 10 ? Math.round(d * 10) / 10 : Math.round(d);
}

const CATEGORY_ICONS = {
    design: '🎨',
    development: '💻',
    writing: '✍️',
    repairs: '🔧',
    cleaning: '🧹',
    delivery: '🚚',
    photo_video: '📷',
    tutoring: '📚',
    beauty: '💄',
    events: '🎉',
    business: '💼',
    other: '📦'
};

const CATEGORY_NAMES = {
    design: 'Дизайн',
    development: 'Разработка',
    writing: 'Тексты',
    repairs: 'Ремонт',
    cleaning: 'Уборка',
    delivery: 'Доставка',
    photo_video: 'Фото/Видео',
    tutoring: 'Репетиторство',
    beauty: 'Красота',
    events: 'Мероприятия',
    business: 'Бизнес',
    other: 'Другое'
};

const RADIUS_OPTIONS = [
    { label: 'Все', value: 0 },
    { label: '5 км', value: 5 },
    { label: '10 км', value: 10 },
    { label: '25 км', value: 25 },
    { label: '50 км', value: 50 },
];

export const TaskMap = ({
    tasks = [],
    onTaskClick,
    selectedTaskId = null,
    className = "",
    height = "100%",
    userRole = "specialist"
}) => {
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
            script.src = `https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=ru_RU`;
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
            alert('Геолокация не поддерживается вашим устройством');
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
                alert('Не удалось определить местоположение. Проверьте разрешения в браузере.');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    }, []);

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
                    <div className="text-4xl mb-3">⚠️</div>
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
            <div className="absolute top-3 left-3 right-3 flex flex-col gap-2 pointer-events-none z-10">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    {/* Left Quick Actions */}
                    <div className="flex items-center gap-1.5 glass rounded-xl p-1 pointer-events-auto shadow-card">
                        <button
                            type="button"
                            onClick={locateUser}
                            disabled={geoLocating}
                            title="Определить мое местоположение"
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition ${userLocation ? 'bg-accent text-white glow-accent-sm' : 'bg-surface-2 text-ink hover:bg-elevated'}`}
                        >
                            {geoLocating ? (
                                <span className="animate-spin text-sm">⏳</span>
                            ) : (
                                <span className="text-sm">📍</span>
                            )}
                            <span className="hidden sm:inline">Рядом со мной</span>
                        </button>

                        <button
                            type="button"
                            onClick={fitAllMarkers}
                            title="Показать все заказы на карте"
                            className="px-2.5 py-1.5 bg-surface-2 hover:bg-elevated text-ink rounded-lg text-xs font-bold transition flex items-center gap-1"
                        >
                            <span>🎯</span>
                            <span className="hidden sm:inline">Все метки ({filteredTasks.length})</span>
                        </button>
                    </div>

                    {/* Right View Controls */}
                    <div className="flex items-center gap-1.5 glass rounded-xl p-1 pointer-events-auto shadow-card">
                        <button
                            type="button"
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            title={isFullscreen ? "Свернуть" : "На весь экран"}
                            className="p-1.5 px-2.5 bg-surface-2 hover:bg-elevated text-ink rounded-lg text-xs font-bold transition flex items-center gap-1"
                        >
                            <span>{isFullscreen ? '✕' : '⛶'}</span>
                            <span className="hidden md:inline">{isFullscreen ? 'Закрыть' : 'Во весь экран'}</span>
                        </button>
                    </div>
                </div>

                {/* Radius filter pills (visible when location active) */}
                {userLocation && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pointer-events-auto no-scrollbar">
                        <span className="glass rounded-lg px-2.5 py-1 text-[11px] font-bold text-muted uppercase tracking-wider whitespace-nowrap shadow-sm">
                            Радиус:
                        </span>
                        {RADIUS_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setSelectedRadius(opt.value)}
                                className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition shadow-sm ${selectedRadius === opt.value ? 'bg-accent text-white glow-accent-sm' : 'glass text-ink hover:bg-surface-2'}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Categories quick bar */}
                {availableCategories.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pointer-events-auto no-scrollbar">
                        <button
                            type="button"
                            onClick={() => setActiveCategory('')}
                            className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition shadow-sm ${activeCategory === '' ? 'bg-accent text-white glow-accent-sm' : 'glass text-ink hover:bg-surface-2'}`}
                        >
                            Все ({tasksWithLocation.length})
                        </button>
                        {availableCategories.map(cat => (
                            <button
                                key={cat}
                                type="button"
                                onClick={() => setActiveCategory(cat === activeCategory ? '' : cat)}
                                className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition shadow-sm flex items-center gap-1 ${activeCategory === cat ? 'bg-accent text-white glow-accent-sm' : 'glass text-ink hover:bg-surface-2'}`}
                            >
                                <span>{CATEGORY_ICONS[cat] || '📌'}</span>
                                <span>{CATEGORY_NAMES[cat] || cat}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom Floating Task Preview Card / Bottom Sheet */}
            {activePreviewTask && (
                <div className="absolute bottom-3 left-3 right-3 md:left-auto md:right-3 md:max-w-md z-20 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-200">
                    <div className="glass rounded-2xl p-4 md:p-5 shadow-pop border border-accent/40 bg-surface/95 backdrop-blur-md">
                        {/* Header & Close */}
                        <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="rounded-full bg-surface-2 border border-border text-ink text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5">
                                    {CATEGORY_ICONS[activePreviewTask.category] || '📌'} {CATEGORY_NAMES[activePreviewTask.category] || activePreviewTask.category}
                                </span>
                                {userLocation && (
                                    <span className="rounded-full bg-accent/20 border border-accent/40 text-accent-bright text-[10px] font-bold px-2 py-0.5">
                                        📍 ~{calculateDistance(userLocation[0], userLocation[1], activePreviewTask.latitude, activePreviewTask.longitude)} км от вас
                                    </span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => setActivePreviewTask(null)}
                                className="w-7 h-7 rounded-full bg-surface-2 hover:bg-elevated text-muted hover:text-ink flex items-center justify-center text-sm font-bold transition"
                                title="Закрыть"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Title & Price */}
                        <div className="flex justify-between items-baseline gap-2 mb-1.5">
                            <h4 className="font-extrabold text-base text-ink line-clamp-1">
                                {activePreviewTask.title}
                            </h4>
                            <span className="font-display font-bold text-accent-bright text-base whitespace-nowrap">
                                {activePreviewTask.budget ? `${Number(activePreviewTask.budget).toLocaleString('ru-RU')} ₽` : 'Договорная'}
                            </span>
                        </div>

                        {/* Address & Description */}
                        <div className="text-xs text-muted mb-2 flex items-center gap-1.5 font-medium">
                            <span>📍 {activePreviewTask.city}{activePreviewTask.address ? `, ${activePreviewTask.address}` : ''}</span>
                        </div>
                        <p className="text-xs text-ink/80 line-clamp-2 mb-3 leading-relaxed">
                            {activePreviewTask.description}
                        </p>

                        {/* Actions */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                            <span className="text-[11px] font-bold text-muted">
                                Статус: <span className={activePreviewTask.status === 'open' ? 'text-success' : 'text-muted'}>{activePreviewTask.status === 'open' ? 'Открыт' : activePreviewTask.status}</span>
                            </span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (onTaskClick) {
                                            onTaskClick(activePreviewTask.id);
                                        }
                                    }}
                                    className="px-4 py-2 bg-accent hover:bg-accent-bright text-white rounded-xl text-xs font-display uppercase tracking-wider transition glow-accent-sm"
                                >
                                    {userRole === 'specialist' && activePreviewTask.status === 'open' ? 'Откликнуться' : 'Подробнее'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const LocationPicker = ({
    initialLocation = null,
    onLocationSelect,
    city = 'Москва',
    address = '',
    onAddressChange = null
}) => {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const marker = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    const [locating, setLocating] = useState(false);
    const [detectedAddress, setDetectedAddress] = useState(address || '');

    const cityCoords = {
        'Москва': [55.751574, 37.573856],
        'Санкт-Петербург': [59.9343, 30.3351],
        'Новосибирск': [55.0084, 82.9357],
        'Екатеринбург': [56.8389, 60.6057],
        'Казань': [55.8304, 49.0661],
        'Нижний Новгород': [56.3269, 44.0059],
        'Челябинск': [55.1644, 61.4368],
        'Самара': [53.1959, 50.1002],
        'Ростов-на-Дону': [47.2357, 39.7015],
        'Краснодар': [45.0355, 38.9753]
    };

    useEffect(() => {
        let isMounted = true;
        const loadScript = () => {
            if (window.ymaps) {
                window.ymaps.ready(() => { if (isMounted) initMap(); });
                return;
            }
            const script = document.createElement('script');
            script.src = `https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=ru_RU`;
            script.async = true;
            script.onload = () => {
                if (window.ymaps) {
                    window.ymaps.ready(() => { if (isMounted) initMap(); });
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

    const reverseGeocode = (coords) => {
        if (!window.ymaps) return;
        window.ymaps.geocode(coords).then(res => {
            const firstGeoObject = res.geoObjects.get(0);
            if (firstGeoObject) {
                const addr = firstGeoObject.getAddressLine();
                setDetectedAddress(addr);
                if (onAddressChange) {
                    onAddressChange(addr);
                }
            }
        }).catch(err => {
            console.warn("Reverse geocode error:", err);
        });
    };

    const initMap = () => {
        if (!mapRef.current || mapInstance.current || !window.ymaps) return;

        const center = initialLocation || cityCoords[city] || MOSCOW_CENTER;

        const map = new window.ymaps.Map(mapRef.current, {
            center,
            zoom: 13,
            controls: ['zoomControl']
        }, {
            suppressMapOpenBlock: true
        });

        map.behaviors.enable(['drag', 'dblClickZoom', 'multiTouch']);

        map.events.add('click', (e) => {
            const coords = e.get('coords');
            setMarker(coords);
            reverseGeocode(coords);
            if (onLocationSelect) {
                onLocationSelect(coords);
            }
        });

        mapInstance.current = map;
        setMapReady(true);

        if (initialLocation) {
            setMarker(initialLocation);
        }
    };

    const setMarker = (coords) => {
        if (!mapInstance.current || !window.ymaps) return;

        if (marker.current) {
            mapInstance.current.geoObjects.remove(marker.current);
        }

        const placemark = new window.ymaps.Placemark(coords, {
            hintContent: 'Перетащите метку для уточнения адреса'
        }, {
            preset: 'islands#redDotIcon',
            draggable: true
        });

        placemark.events.add('dragend', () => {
            const newCoords = placemark.geometry.getCoordinates();
            reverseGeocode(newCoords);
            if (onLocationSelect) {
                onLocationSelect(newCoords);
            }
        });

        marker.current = placemark;
        mapInstance.current.geoObjects.add(placemark);
    };

    const handleLocateMe = () => {
        if (!navigator.geolocation) return;
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const coords = [pos.coords.latitude, pos.coords.longitude];
                setLocating(false);
                if (mapInstance.current) {
                    mapInstance.current.setCenter(coords, 15);
                    setMarker(coords);
                    reverseGeocode(coords);
                    if (onLocationSelect) {
                        onLocationSelect(coords);
                    }
                }
            },
            () => setLocating(false)
        );
    };

    return (
        <div className="w-full relative">
            <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold text-muted uppercase tracking-wider">
                    📍 Укажите точку на карте
                </span>
                <button
                    type="button"
                    onClick={handleLocateMe}
                    disabled={locating}
                    className="text-xs text-accent-bright hover:underline font-bold flex items-center gap-1"
                >
                    {locating ? '⏳ Поиск...' : '📍 Моё местоположение'}
                </button>
            </div>

            <div className="w-full h-60 relative rounded-xl overflow-hidden border border-border">
                <div ref={mapRef} className="w-full h-full" />
                {!mapReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface-2 text-muted text-xs font-semibold">
                        Загрузка карты...
                    </div>
                )}
            </div>

            {detectedAddress && (
                <div className="mt-2 text-xs text-ink/80 bg-surface-2 p-2.5 rounded-xl border border-border flex items-center gap-2">
                    <span className="text-accent-bright font-bold">Адрес:</span>
                    <span className="truncate">{detectedAddress}</span>
                </div>
            )}
        </div>
    );
};
